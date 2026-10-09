import type { AgentEvent, AgentMessage } from "@modex/agent";
import { Agent, createDefaultTools, createSessionId, listSessions, loadSession, saveSession } from "@modex/agent";
import type { ModelSelection, ModexModel, ModexRuntime } from "@modex/ai";
import { createModexModels, PaidModelBlockedError } from "@modex/ai";
import chalk from "chalk";
import { parseArgs, printHelp } from "./cli/args.js";
import { loadDotEnv } from "./cli/dotenv.js";
import { fallbackNote, runWithFallback } from "./cli/fallback.js";
import { pickModelInteractive } from "./cli/model-picker.js";
import { createPermissionChecker } from "./cli/permissions.js";
import { createRenderState, renderEvent, renderUsageSummary } from "./cli/render.js";
import { startRepl } from "./cli/repl.js";
import { configDir, loadSettings, sessionsDir } from "./cli/settings.js";
import { renderWelcome } from "./cli/welcome.js";

const VERSION = "0.0.1";

export async function main(argv: string[]): Promise<void> {
	loadDotEnv();
	const args = parseArgs(argv);

	if (args.version) {
		console.log(VERSION);
		return;
	}

	if (args.help) {
		printHelp();
		return;
	}

	const settings = loadSettings();
	const paidOptIn = args.paid ?? settings.paid ?? false;
	const runtime = createModexModels();

	const anyKeyAvailable = runtime.providers.some((p) => runtime.isProviderAvailable(p.id));
	if (!anyKeyAvailable) {
		console.error(chalk.red("No provider API keys found."));
		console.error("");
		console.error("Add a key to ~/.modex/.env (global) or ./.env (this project):");
		console.error(chalk.dim("  GROQ_API_KEY=gsk_...        https://console.groq.com/keys"));
		console.error(chalk.dim("  CEREBRAS_API_KEY=csk-...    https://cloud.cerebras.ai/"));
		console.error(chalk.dim("  TOGETHER_API_KEY=...        https://api.together.ai/settings/api-keys"));
		console.error(chalk.dim("  FIREWORKS_API_KEY=fw_...    https://fireworks.ai/keys"));
		console.error(chalk.dim("  OPENROUTER_API_KEY=skor-... https://openrouter.ai/keys"));
		console.error(chalk.dim("  NVIDIA_API_KEY=nvapi-...    https://build.nvidia.com/"));
		console.error("");
		console.error("Or set a real environment variable (PowerShell, current session):");
		console.error(chalk.dim('  $env:GROQ_API_KEY = "gsk_..."'));
		console.error(chalk.dim('  setx GROQ_API_KEY "gsk_..."   # permanent (new terminals only)'));
		console.error("");
		console.error("Or use a paid provider with explicit opt-in:");
		console.error(chalk.dim("  OPENAI_API_KEY=sk-... in .env, then run with --paid"));
		process.exitCode = 1;
		return;
	}

	let selection: ModelSelection;
	try {
		selection = await runtime.router.selectModel(
			{
				provider: args.provider ?? settings.provider,
				modelPattern: args.model ?? settings.model,
				thinkingLevel: settings.thinkingLevel,
			},
			paidOptIn,
		);
	} catch (error) {
		if (error instanceof PaidModelBlockedError) {
			console.error(chalk.red(error.message));
			if (error.info.availablePaidModels.length > 0) {
				console.error(chalk.dim(`Paid models available with --paid: ${error.info.availablePaidModels.join(", ")}`));
			}
			process.exitCode = 1;
			return;
		}
		throw error;
	}

	let primaryModel = selection.model;
	if (args.pick) {
		const picked = await pickModelInteractive({ runtime, paidOptIn, current: selection.model });
		if (picked) primaryModel = picked;
	}

	const cwd = process.cwd();
	const yolo = args.yolo;
	const permissionChecker = yolo ? async () => "allow" as const : createPermissionChecker();
	const tools = createDefaultTools({ cwd });

	const sessionId = args.resume ?? createSessionId();
	let messages: AgentMessage[] = [];

	if (args.resume || args.continueSession) {
		const dir = sessionsDir();
		const id = args.resume ?? listSessions(dir)[0]?.id;
		if (id) {
			const loaded = loadSession(dir, id);
			if (loaded) {
				messages = loaded.messages;
				console.error(chalk.dim(`Resumed session ${id} (${messages.length} messages)`));
			} else {
				console.error(chalk.yellow(`Session ${id} not found; starting fresh`));
			}
		}
	}

	const agent = new Agent({
		streamFn: (model, context, options) => runtime.models.stream(model, context, options),
		initialState: {
			model: primaryModel,
			thinkingLevel: settings.thinkingLevel ?? "off",
			tools,
			messages,
		},
		sessionId,
		beforeToolCall: async (context) => {
			const decision = await permissionChecker({
				toolName: context.toolCall.name,
				summary: formatToolSummary(context.toolCall.name, context.toolCall.arguments),
			});
			if (decision === "deny") {
				return { block: true, reason: "User denied permission" };
			}
			return undefined;
		},
	});

	const persist = () => {
		try {
			saveSession(sessionsDir(), sessionId, agent.state.messages);
		} catch (error) {
			console.error(chalk.dim(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`));
		}
	};

	const freePool = runtime.router.getFreeEligibleModels().filter((m) => m !== primaryModel);
	const cross = freePool.filter((m) => m.provider !== primaryModel.provider);
	const same = freePool.filter((m) => m.provider === primaryModel.provider);
	const candidates = [primaryModel, ...cross, ...same].slice(0, 11);

	if (args.prompt.length > 0) {
		printBanner(primaryModel, paidOptIn);
		await runOnce(agent, runtime, candidates, args.prompt.join(" "), persist);
		return;
	}

	renderWelcome({
		version: VERSION,
		cwd,
		model: primaryModel,
		hasProviderKey: runtime.isProviderAvailable(primaryModel.provider),
		paidOptIn,
	});

	const renderState = createRenderState();

	await startRepl({
		agent,
		runtime,
		sessionId,
		tools,
		permissionChecker,
		paidOptIn,
		persist,
		candidates,
		renderState,
	});
}

async function runOnce(
	agent: Agent,
	runtime: ModexRuntime,
	candidates: ModexModel[],
	prompt: string,
	persist: () => void,
): Promise<void> {
	const state = createRenderState();
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
				console.error(chalk.yellow(`⚠ ${fallbackNote(from, to, errorKind, errorMessage)}`));
			},
		});
		if (result.message?.errorMessage) {
			process.exitCode = 1;
		}
	} finally {
		unsubscribe();
		persist();
		renderUsageSummary(state);
	}
}

function displayModelId(model: ModexModel): string {
	return model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
}

function printBanner(model: ModexModel, paidOptIn: boolean): void {
	const freeTag = model.freeMetadata.freeEligibility === "free" ? chalk.green("[free]") : chalk.yellow("[paid]");
	const paidNote = paidOptIn ? chalk.yellow(" (paid opt-in enabled)") : "";
	console.error(chalk.dim(`modex v${VERSION} — model: ${displayModelId(model)} ${freeTag}${paidNote}`));
	console.error(chalk.dim(`config: ${configDir()} | sessions: ${sessionsDir()}`));
	console.error(chalk.dim("type /help for commands, /quit to exit\n"));
}

function formatToolSummary(toolName: string, args: unknown): string {
	const record = (args ?? {}) as Record<string, unknown>;
	switch (toolName) {
		case "bash":
			return `$ ${String(record.command ?? "")}`;
		case "read":
			return `Read ${String(record.path ?? "")}`;
		case "write":
			return `Write ${String(record.path ?? "")} (${String(record.content ?? "").length} chars)`;
		case "edit":
			return `Edit ${String(record.path ?? "")}`;
		case "ls":
			return `List ${String(record.path ?? ".")}`;
		case "grep":
			return `Search /${String(record.pattern ?? "")}/`;
		case "glob":
			return `Find ${String(record.pattern ?? "")}`;
		default:
			return JSON.stringify(record).slice(0, 200);
	}
}

export { runOnce };
export type { ModexRuntime };
