import { stdin, stdout } from "node:process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import type { Agent, AgentEvent, AgentMessage, AgentTool } from "@modex/agent";
import { listSessions } from "@modex/agent";
import type { ModexModel, ModexRuntime } from "@modex/ai";
import chalk from "chalk";
import { orange } from "./colors.js";
import { fallbackNote, runWithFallback } from "./fallback.js";
import { formatGitStatus, getProjectInfo } from "./project-awareness.js";
import { createRenderState, renderEvent, renderUsageSummary, type RenderState } from "./render.js";
import { sessionsDir, updateSettings } from "./settings.js";
import { getTheme, getThemeNames, setTheme } from "./themes.js";

export interface ReplOptions {
	agent: Agent;
	runtime: ModexRuntime;
	sessionId: string;
	tools: AgentTool[];
	permissionChecker: (request: { toolName: string; summary: string }) => Promise<"allow" | "deny">;
	paidOptIn: boolean;
	persist: () => void;
	candidates: ModexModel[];
	renderState: RenderState;
}

const BOX_TOP_LEFT = "┌";
const BOX_TOP_RIGHT = "┐";
const BOX_BOTTOM_LEFT = "└";
const BOX_BOTTOM_RIGHT = "┘";
const BOX_HORIZONTAL = "─";
const BOX_VERTICAL = "│";

function getTerminalWidth(): number {
	return process.stdout.columns ?? 80;
}

function drawInputBox(promptText: string, width: number): string {
	const innerWidth = width - 4;
	const promptVisible = promptText.length;
	const padded = promptText + " ".repeat(Math.max(0, innerWidth - promptVisible));
	const top = `${BOX_TOP_LEFT}${BOX_HORIZONTAL.repeat(innerWidth)}${BOX_TOP_RIGHT}`;
	const middle = `${BOX_VERTICAL} ${padded} ${BOX_VERTICAL}`;
	const bottom = `${BOX_BOTTOM_LEFT}${BOX_HORIZONTAL.repeat(innerWidth)}${BOX_BOTTOM_RIGHT}`;
	return `${top}\n${middle}\n${bottom}`;
}

function drawModelSelectorBox(
	models: ModexModel[],
	current?: ModexModel,
	hasKey?: (provider: string) => boolean,
	width: number = 60,
): string[] {
	const lines: string[] = [];
	const innerWidth = width - 4;
	const title = " MODEL SELECTOR ";
	const titlePad = Math.max(0, innerWidth - title.length);
	const leftPad = Math.floor(titlePad / 2);
	const rightPad = titlePad - leftPad;

	lines.push(
		`${BOX_TOP_LEFT}${BOX_HORIZONTAL.repeat(leftPad)}${chalk.bold(title)}${BOX_HORIZONTAL.repeat(rightPad)}${BOX_TOP_RIGHT}`,
	);

	const freeModels = models.filter((m) => m.freeMetadata.freeEligibility === "free");
	const paidModels = models.filter((m) => m.freeMetadata.freeEligibility === "paid");

	if (freeModels.length > 0) {
		lines.push(`${BOX_VERTICAL} ${chalk.bold("Free models:")}${" ".repeat(innerWidth - 13)}${BOX_VERTICAL}`);
		for (let i = 0; i < freeModels.length; i++) {
			const m = freeModels[i];
			const isCurrent = current && m.id === current.id && m.provider === current.provider;
			const prefix = isCurrent ? chalk.green("► ") : "  ";
			const num = chalk.dim(`${i + 1}.`);
			const modelLabel = m.id.startsWith(`${m.provider}/`) ? m.id : `${m.provider}/${m.id}`;
			const keyTag = hasKey?.(m.provider) ? chalk.green("✓") : chalk.yellow("✗");
			const ctxTag = chalk.dim(`(${m.contextWindow / 1000}k)`);
			const lineContent = `${prefix}${num} ${chalk.cyan(modelLabel)} ${ctxTag} ${keyTag}`;
			const visibleLen = lineContent.replace(/\x1b\[[0-9;]*m/g, "").length;
			const pad = Math.max(0, innerWidth - visibleLen);
			lines.push(`${BOX_VERTICAL} ${lineContent}${" ".repeat(pad)} ${BOX_VERTICAL}`);
		}
	}

	if (paidModels.length > 0) {
		lines.push(
			`${BOX_VERTICAL} ${chalk.bold.yellow("Paid models (require --paid):")}${" ".repeat(innerWidth - 29)}${BOX_VERTICAL}`,
		);
		for (let i = 0; i < paidModels.length; i++) {
			const m = paidModels[i];
			const isCurrent = current && m.id === current.id && m.provider === current.provider;
			const prefix = isCurrent ? chalk.green("► ") : "  ";
			const num = chalk.dim(`${freeModels.length + i + 1}.`);
			const modelLabel = m.id.startsWith(`${m.provider}/`) ? m.id : `${m.provider}/${m.id}`;
			const ctxTag = chalk.dim(`(${m.contextWindow / 1000}k)`);
			const lineContent = `${prefix}${num} ${chalk.yellow(modelLabel)} ${ctxTag}`;
			const visibleLen = lineContent.replace(/\x1b\[[0-9;]*m/g, "").length;
			const pad = Math.max(0, innerWidth - visibleLen);
			lines.push(`${BOX_VERTICAL} ${lineContent}${" ".repeat(pad)} ${BOX_VERTICAL}`);
		}
	}

	lines.push(
		`${BOX_VERTICAL} ${chalk.dim("Enter number, or type to filter:")}${" ".repeat(innerWidth - 30)} ${BOX_VERTICAL}`,
	);
	lines.push(`${BOX_BOTTOM_LEFT}${BOX_HORIZONTAL.repeat(innerWidth)}${BOX_BOTTOM_RIGHT}`);

	return lines;
}

async function promptWithInputBox(rl: ReadlineInterface, promptLabel: string): Promise<string> {
	const width = getTerminalWidth();
	const boxTop = drawInputBox("", width).split("\n")[0];
	const boxBottom = drawInputBox("", width).split("\n")[2];

	stdout.write(`\n${boxTop}\n`);
	const answer = await rl.question(`${orange("│")} ${promptLabel} `);
	stdout.write(`${boxBottom}\n`);
	return answer;
}

export async function startRepl(options: ReplOptions): Promise<void> {
	const { agent, sessionId, persist } = options;
	const rl = createInterface({ input: stdin, output: stdout, terminal: true });

	const cleanup = () => {
		rl.close();
	};
	process.on("SIGINT", () => {
		if (agent.state.isStreaming) {
			agent.abort();
			stdout.write(chalk.dim("\n(aborting current turn)\n"));
		} else {
			cleanup();
			process.exit(0);
		}
	});

	try {
		const renderState = createRenderState();
		options.renderState = renderState;
		let running = true;
		while (running) {
			let line: string;
			try {
				line = await promptWithInputBox(rl, orange("modex>"));
			} catch {
				break;
			}
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;

			if (trimmed.startsWith("/")) {
				const [command, ...rest] = trimmed.slice(1).split(/\s+/);
				running = await handleCommand(command.toLowerCase(), rest, options);
				continue;
			}

			await runPrompt(agent, options, trimmed);
		}
	} finally {
		cleanup();
		persist();
		console.error(chalk.dim(`Session saved: ${sessionId}`));
	}
}

async function runPrompt(agent: Agent, options: ReplOptions, prompt: string): Promise<void> {
	const { runtime, persist, candidates, renderState } = options;
	const state = renderState;
	const unsubscribe = agent.subscribe((event: AgentEvent) => {
		renderEvent(event, state);
	});

	const userMessage: AgentMessage = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	try {
		const result = await runWithFallback({
			agent,
			router: runtime.router,
			candidates,
			userMessage,
			onFallback: (from, to, errorKind, errorMessage) => {
				stdout.write(chalk.yellow(`\n⚠ ${fallbackNote(from, to, errorKind, errorMessage)}\n`));
			},
		});
		if (result.failedAttempts.length > 0 && !result.message?.errorMessage) {
			options.candidates = [result.finalModel, ...candidates.filter((m) => m !== result.finalModel)];
		}
	} catch (error) {
		stdout.write(chalk.red(`\n${error instanceof Error ? error.message : String(error)}\n`));
	} finally {
		unsubscribe();
		persist();
		renderUsageSummary(state);
	}
}

async function handleCommand(command: string, rest: string[], options: ReplOptions): Promise<boolean> {
	const { agent, runtime, sessionId, renderState } = options;

	switch (command) {
		case "help":
		case "h":
			printReplHelp();
			return true;

		case "quit":
		case "exit":
		case "q":
			return false;

		case "new": {
			agent.reset();
			stdout.write(chalk.dim("Started a fresh conversation (session file will be reused until restart).\n"));
			return true;
		}

		case "models": {
			const all = runtime.models.getAllModels();
			const freeModels = all.filter((m) => m.freeMetadata.freeEligibility === "free");
			const paidModels = all.filter((m) => m.freeMetadata.freeEligibility === "paid");
			const current = agent.state.model;
			stdout.write(chalk.bold("\nFree models:\n"));
			for (const m of freeModels) {
				const key = envKeyFor(m.provider);
				const hasKey = key ? Boolean(process.env[key]) : false;
				const marker = m.provider === current.provider && m.id === current.id ? chalk.green("* ") : "  ";
				const keyTag = hasKey ? chalk.green("key ✓") : chalk.dim(`set ${key ?? "API_KEY"}`);
				const label = m.id.startsWith(`${m.provider}/`) ? m.id : `${m.provider}/${m.id}`;
				stdout.write(`${marker}${chalk.cyan(label)} ${chalk.dim(`(${m.contextWindow / 1000}k ctx)`)} ${keyTag}\n`);
			}
			if (paidModels.length > 0) {
				stdout.write(chalk.bold("\nPaid models (require --paid):\n"));
				for (const m of paidModels) {
					const marker = m.provider === current.provider && m.id === current.id ? chalk.green("* ") : "  ";
					stdout.write(`${marker}${chalk.yellow(`${m.provider}/${m.id}`)}\n`);
				}
			}
			stdout.write(`\n${chalk.dim("Use /model to pick one, or /model <name> to switch by pattern.")}\n`);
			return true;
		}

		case "model": {
			const pattern = rest.join(" ");
			if (!pattern) {
				const models = runtime.router.getFreeEligibleModels();
				const paidModels = options.paidOptIn ? runtime.router.getPaidModels() : [];
				const allModels = [...models, ...paidModels];

				const width = Math.min(getTerminalWidth(), 80);
				const boxLines = drawModelSelectorBox(
					allModels,
					agent.state.model as ModexModel,
					(p) => runtime.isProviderAvailable(p),
					width,
				);
				stdout.write(`\n${boxLines.join("\n")}\n`);

				const answer = await rlQuestion(`${orange("Select model #: ")}`);
				const num = parseInt(answer.trim(), 10);
				if (Number.isFinite(num) && num >= 1 && num <= allModels.length) {
					const picked = allModels[num - 1];
					agent.state.model = picked;
					const others = runtime.router.getFreeEligibleModels().filter((m) => m !== picked);
					const cross = others.filter((m) => m.provider !== picked.provider);
					const same = others.filter((m) => m.provider === picked.provider);
					options.candidates = [picked, ...cross, ...same].slice(0, 11);
					updateSettings({ model: picked.id });
					stdout.write(chalk.dim(`\nSwitched to ${picked.provider}/${picked.id}\n`));
				}
				return true;
			}
			try {
				const selection = await runtime.router.selectModel({ modelPattern: pattern }, options.paidOptIn);
				agent.state.model = selection.model;
				options.candidates = [selection.model, ...selection.fallbacks];
				updateSettings({ model: pattern });
				stdout.write(chalk.dim(`Switched to ${selection.model.provider}/${selection.model.id}\n`));
			} catch (error) {
				stdout.write(chalk.red(`${error instanceof Error ? error.message : String(error)}\n`));
			}
			return true;
		}

		case "sessions": {
			const sessions = listSessions(sessionsDir());
			if (sessions.length === 0) {
				stdout.write(chalk.dim("No saved sessions\n"));
				return true;
			}
			stdout.write(chalk.bold("\nSessions:\n"));
			for (const s of sessions.slice(0, 20)) {
				const marker = s.id === sessionId ? chalk.green("* ") : "  ";
				const when = new Date(s.updatedAt).toLocaleString();
				stdout.write(
					`${marker}${s.id} ${chalk.dim(`${s.messageCount} msgs — ${when}`)} ${s.title ? chalk.dim(`— ${s.title}`) : ""}\n`,
				);
			}
			stdout.write("\n");
			return true;
		}

		case "session": {
			const id = rest[0];
			if (!id) {
				stdout.write(chalk.yellow("Usage: /session <id>  (use /sessions to list)\n"));
				return true;
			}
			stdout.write(chalk.dim(`To resume a session, restart with: modex --resume ${id}\n`));
			return true;
		}

		case "status": {
			const project = getProjectInfo();
			const model = agent.state.model as ModexModel;
			const theme = getTheme();
			stdout.write(chalk.bold("\nStatus:\n"));
			stdout.write(`  Project: ${theme.model(project.name)}  ${theme.dim(project.root)}\n`);
			if (project.git) {
				stdout.write(`  Git:     ${formatGitStatus(project.git)}\n`);
			} else {
				stdout.write(`  Git:     ${theme.dim("Not a git repository")}\n`);
			}
			stdout.write(
				`  Model:   ${theme.model(model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`)} ${model.freeMetadata.freeEligibility === "free" ? theme.success("[free]") : theme.warning("[paid]")}\n`,
			);
			stdout.write(
				`  Provider: ${theme.provider(model.provider)} ${runtime.isProviderAvailable(model.provider) ? theme.success("✓ connected") : theme.error("✗ no key")}\n`,
			);
			stdout.write(
				`  Routing:  ${options.paidOptIn ? theme.warning("Paid opt-in") : theme.success("Free-first")}\n`,
			);
			const state = createRenderState();
			stdout.write(
				`  Tokens:   ${theme.dim(`${state.totalUsage.input} in + ${state.totalUsage.output} out = ${state.totalUsage.input + state.totalUsage.output} total`)}  ${state.totalUsage.cost > 0 ? theme.warning(`$${state.totalUsage.cost.toFixed(4)}`) : ""}\n`,
			);
			stdout.write(
				`  Permissions: ${options.permissionChecker.toString().includes("yolo") ? theme.warning("YOLO") : theme.success("ASK")}\n`,
			);
			stdout.write("\n");
			return true;
		}

		case "providers": {
			const theme = getTheme();
			const providers = runtime.providers;
			stdout.write(chalk.bold("\nProviders:\n"));
			for (const p of providers) {
				const hasKey = runtime.isProviderAvailable(p.id);
				const models = runtime.models.getAllModels(p.id) || [];
				const freeCount = models.filter((m) => m.freeMetadata?.freeEligibility === "free").length;
				const paidCount = models.filter((m) => m.freeMetadata?.freeEligibility === "paid").length;
				const status = hasKey ? theme.success("✓ configured") : theme.error("✗ no API key");
				stdout.write(
					`  ${theme.provider(p.id.padEnd(12))} ${status}  ${theme.dim(`${freeCount} free, ${paidCount} paid models`)}\n`,
				);
			}
			stdout.write(`\n${theme.dim("Set API keys in ~/.modex/.env or environment variables.")}\n`);
			return true;
		}

		case "connect": {
			const theme = getTheme();
			const provider = rest[0];
			if (!provider) {
				stdout.write(chalk.bold("\nConfigure a Provider:\n"));
				stdout.write(`  Usage: /connect <provider>\n`);
				stdout.write(`  Available: groq, cerebras, together, fireworks, openrouter, nvidia, openai\n\n`);
				stdout.write(`  Add API key to ~/.modex/.env:\n`);
				stdout.write(`    GROQ_API_KEY=gsk_...\n`);
				stdout.write(`    CEREBRAS_API_KEY=csk-...\n`);
				stdout.write(`    TOGETHER_API_KEY=...\n`);
				stdout.write(`    FIREWORKS_API_KEY=fw_...\n`);
				stdout.write(`    OPENROUTER_API_KEY=skor-...\n`);
				stdout.write(`    NVIDIA_API_KEY=nvapi-...\n`);
				stdout.write(`    OPENAI_API_KEY=sk-... (requires --paid)\n`);
				return true;
			}
			const keyMap: Record<string, string> = {
				groq: "GROQ_API_KEY",
				cerebras: "CEREBRAS_API_KEY",
				together: "TOGETHER_API_KEY",
				fireworks: "FIREWORKS_API_KEY",
				openrouter: "OPENROUTER_API_KEY",
				nvidia: "NVIDIA_API_KEY",
				openai: "OPENAI_API_KEY",
			};
			const envVar = keyMap[provider.toLowerCase()];
			if (!envVar) {
				stdout.write(chalk.red(`Unknown provider: ${provider}\n`));
				return true;
			}
			const hasKey = !!process.env[envVar];
			stdout.write(`Provider: ${theme.provider(provider)}\n`);
			stdout.write(`Env var:  ${envVar}\n`);
			stdout.write(`Status:   ${hasKey ? theme.success("✓ configured") : theme.error("✗ not set")}\n`);
			if (!hasKey) {
				stdout.write(`\nGet your key from:\n`);
				const urls: Record<string, string> = {
					groq: "https://console.groq.com/keys",
					cerebras: "https://cloud.cerebras.ai/",
					together: "https://api.together.ai/settings/api-keys",
					fireworks: "https://fireworks.ai/keys",
					openrouter: "https://openrouter.ai/keys",
					nvidia: "https://build.nvidia.com/",
					openai: "https://platform.openai.com/api-keys",
				};
				if (urls[provider.toLowerCase()]) {
					stdout.write(`  ${urls[provider.toLowerCase()]}\n`);
				}
				stdout.write(`\nThen add to ~/.modex/.env:\n  ${envVar}=your-key-here\n`);
			}
			return true;
		}

		case "clear": {
			agent.reset();
			stdout.write(chalk.green("Conversation cleared (history preserved in session file).\n"));
			return true;
		}

		case "compact": {
			if (agent.state.messages.length > 10) {
				const keep = agent.state.messages.slice(-10);
				agent.state.messages = keep;
				stdout.write(chalk.green(`Context compacted to last 10 messages.\n`));
			} else {
				stdout.write(chalk.dim("Context already compact (≤10 messages).\n"));
			}
			return true;
		}

		case "permissions": {
			const theme = getTheme();
			const settings = await import("./settings.js").then((m) => m.loadSettings());
			const perms = settings.permissions || {};
			stdout.write(chalk.bold("\nPermission Settings:\n"));
			if (Object.keys(perms).length === 0) {
				stdout.write(`  ${theme.dim("No custom permissions set (default: ask for each tool)")}\n`);
			} else {
				for (const [tool, decision] of Object.entries(perms)) {
					const color = decision === "allow" ? theme.success : decision === "deny" ? theme.error : theme.warning;
					stdout.write(`  ${tool.padEnd(12)} ${color(decision)}\n`);
				}
			}
			stdout.write(`\n${theme.dim("Default: ask for each tool. Use --yolo to auto-allow all.")}\n`);
			return true;
		}

		case "diff": {
			stdout.write(chalk.yellow("Diff view not yet implemented. Use Git for file diffs.\n"));
			return true;
		}

		case "undo": {
			stdout.write(chalk.yellow("Undo not yet supported.\n"));
			return true;
		}

		case "redo": {
			stdout.write(chalk.yellow("Redo not yet supported.\n"));
			return true;
		}

		case "doctor": {
			const theme = getTheme();
			stdout.write(chalk.bold("\nModex Diagnostics:\n"));
			const project = getProjectInfo();
			stdout.write(`  Project: ${theme.model(project.name)} (${project.root})\n`);
			stdout.write(`  Config dir: ${theme.dim(require("./settings.js").configDir())}\n`);
			stdout.write(`  Sessions dir: ${theme.dim(require("./settings.js").sessionsDir())}\n\n`);

			stdout.write(chalk.bold("  API Keys:\n"));
			for (const p of runtime.providers) {
				const hasKey = runtime.isProviderAvailable(p.id);
				const status = hasKey ? theme.success("✓") : theme.error("✗");
				stdout.write(`    ${p.id.padEnd(12)} ${status}\n`);
			}

			stdout.write(chalk.bold("\n  Connectivity:\n"));
			for (const p of runtime.providers) {
				if (runtime.isProviderAvailable(p.id)) {
					try {
						const models = runtime.models.getModels(p.id);
						if (models && models.length > 0) {
							stdout.write(`    ${p.id.padEnd(12)} ${theme.success("✓ reachable")} (${models.length} models)\n`);
						} else {
							stdout.write(`    ${p.id.padEnd(12)} ${theme.warning("⚠ no models")}\n`);
						}
					} catch {
						stdout.write(`    ${p.id.padEnd(12)} ${theme.error("✗ error")}\n`);
					}
				}
			}

			stdout.write(chalk.bold("\n  Routing:\n"));
			const freeModels = runtime.router.getFreeEligibleModels();
			stdout.write(`    Free models: ${freeModels.length}\n`);
			if (options.paidOptIn) {
				const paidModels = runtime.router.getPaidModels();
				stdout.write(`    Paid models: ${paidModels.length} (opt-in enabled)\n`);
			} else {
				stdout.write(`    Paid models: blocked (use --paid to enable)\n`);
			}

			stdout.write(chalk.bold("\n  Recommendations:\n"));
			if (freeModels.length === 0) {
				stdout.write(`    ${theme.error("No free models available — add at least one API key")}\n`);
			}
			if (!runtime.isProviderAvailable("nvidia") && !runtime.isProviderAvailable("groq")) {
				stdout.write(`    ${theme.warning("Consider adding NVIDIA or Groq keys for fastest free models")}\n`);
			}
			stdout.write("\n");
			return true;
		}

		case "theme": {
			const themeName = rest[0];
			const theme = getTheme();
			if (!themeName) {
				stdout.write(chalk.bold("\nThemes:\n"));
				for (const name of getThemeNames()) {
					const current = name === theme.name ? theme.success(" ◄ current") : "";
					stdout.write(`  ${name}${current}\n`);
				}
				stdout.write(`\nUsage: /theme <name>\n`);
				return true;
			}
			if (setTheme(themeName)) {
				stdout.write(chalk.green(`Theme set to "${themeName}". Restart to apply fully.\n`));
			} else {
				stdout.write(chalk.red(`Unknown theme: ${themeName}\n`));
				stdout.write(`Available: ${getThemeNames().join(", ")}\n`);
			}
			return true;
		}

case "verbose": {
			renderState.showToolOutputs = !renderState.showToolOutputs;
			stdout.write(chalk.green(`Tool output display: ${renderState.showToolOutputs ? "enabled" : "disabled"}\n`));
			return true;
		}

		case "tool-output": {
			renderState.showToolOutputs = !renderState.showToolOutputs;
			stdout.write(chalk.green(`Tool output display: ${renderState.showToolOutputs ? "enabled" : "disabled"}\n`));
			return true;
		}

		default:
			stdout.write(chalk.yellow(`Unknown command: /${command}. Type /help for available commands.\n`));
			return true;
	}
}

async function rlQuestion(prompt: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout, terminal: true });
	try {
		return await rl.question(prompt);
	} finally {
		rl.close();
	}
}

function envKeyFor(provider: string): string | undefined {
	const map: Record<string, string> = {
		groq: "GROQ_API_KEY",
		cerebras: "CEREBRAS_API_KEY",
		together: "TOGETHER_API_KEY",
		fireworks: "FIREWORKS_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		nvidia: "NVIDIA_API_KEY",
		openai: "OPENAI_API_KEY",
	};
	return map[provider];
}

function printReplHelp(): void {
	stdout.write(`
${chalk.bold("Commands:")}
  /help              Show this help
  /models            List models (free vs paid, key status)
  /model [pattern]   Switch model or run /model for visual selector
  /providers         View configured providers and key status
  /connect [name]    Configure a provider (shows setup URLs)
  /status            Show project, git, model, tokens, routing
  /clear             Clear visible conversation (keeps session)
  /compact           Reduce conversation context to last 10 messages
  /permissions       View tool permission settings
  /diff              Review file changes (not yet implemented)
  /undo              Undo last change (not yet supported)
  /redo              Redo last undone change (not yet supported)
  /doctor            Diagnose configuration and connectivity
  /theme [name]      Change terminal theme (orange, blue, green, etc.)
  /verbose           Toggle tool output display (on/off)
  /tool-output       Toggle tool output display (alias)
  /sessions          List saved sessions
  /session <id>      Hint for resuming a session on restart
  /new               Start a fresh conversation context
  /quit              Exit (Ctrl+C also works)

${chalk.bold("Tips:")}
  Tool calls ask for permission: y=once, a=always, n/d=deny
  Free models need a provider API key set as an env var
  Paid models are blocked unless started with --paid
  Ctrl+J = new line in multiline mode, Ctrl+C = cancel/quit
`);
}
