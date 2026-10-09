import type { AgentEvent } from "@modex/agent";
import chalk from "chalk";

const MAX_TOOL_OUTPUT = 2000;

export interface RenderState {
	assistantTextOpen: boolean;
	thinkingOpen: boolean;
	toolOutputs: Map<string, string>;
	totalUsage: { input: number; output: number; cost: number };
	showToolOutputs: boolean;
}

export function createRenderState(): RenderState {
	return {
		assistantTextOpen: false,
		thinkingOpen: false,
		toolOutputs: new Map(),
		totalUsage: { input: 0, output: 0, cost: 0 },
		showToolOutputs: false,
	};
}

function closeAssistantText(state: RenderState): void {
	if (state.assistantTextOpen) {
		process.stdout.write("\n");
		state.assistantTextOpen = false;
	}
}

function closeThinking(state: RenderState): void {
	if (state.thinkingOpen) {
		process.stdout.write("\n");
		state.thinkingOpen = false;
	}
}

export function renderEvent(event: AgentEvent, state: RenderState): void {
	switch (event.type) {
		case "agent_start":
			break;
		case "agent_end":
			closeAssistantText(state);
			closeThinking(state);
			break;
		case "turn_start":
			closeAssistantText(state);
			process.stdout.write(chalk.dim("── turn ──\n"));
			break;
		case "turn_end": {
			closeAssistantText(state);
			const usage = event.message.role === "assistant" ? event.message.usage : undefined;
			if (usage) {
				state.totalUsage.input += usage.input;
				state.totalUsage.output += usage.output;
				state.totalUsage.cost +=
					usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
			}
			break;
		}
		case "message_start":
			break;
		case "message_update": {
			const e = event.assistantMessageEvent;
			if (e.type === "text_start") {
				closeThinking(state);
				state.assistantTextOpen = true;
			} else if (e.type === "text_delta" && e.delta) {
				process.stdout.write(e.delta);
			} else if (e.type === "text_end") {
				closeAssistantText(state);
			} else if (e.type === "thinking_start") {
				closeAssistantText(state);
				state.thinkingOpen = true;
			} else if (e.type === "thinking_delta" && e.delta) {
				process.stdout.write(chalk.dim(e.delta));
			} else if (e.type === "thinking_end") {
				closeThinking(state);
			}
			break;
		}
		case "message_end":
			closeAssistantText(state);
			closeThinking(state);
			if (event.message.role === "assistant" && event.message.errorMessage) {
				process.stdout.write(chalk.red(`\nError: ${event.message.errorMessage}\n`));
			}
			break;
		case "tool_execution_start": {
			closeAssistantText(state);
			closeThinking(state);
			const brief = formatArgs(event.args);
			process.stdout.write(chalk.cyan(`⏺ ${event.toolName}`) + chalk.dim(`(${brief})\n`));
			break;
		}
		case "tool_execution_update":
			break;
		case "tool_execution_end": {
			const text = extractText(event.result);
			state.toolOutputs.set(event.toolCallId, text);
			if (state.showToolOutputs) {
				const lines = text.split("\n");
				const shown = lines.slice(0, 12).join("\n");
				const truncated = lines.length > 12 ? chalk.dim(`\n… (${lines.length - 12} more lines)`) : "";
				const marker = event.isError ? chalk.red("✗") : chalk.dim("✓");
				process.stdout.write(`${marker} ${chalk.dim(shown.slice(0, MAX_TOOL_OUTPUT))}${truncated}\n`);
			}
			break;
		}
	}
}

export function renderUsageSummary(state: RenderState): void {
	const { input, output, cost } = state.totalUsage;
	if (input + output === 0) return;
	process.stdout.write(
		chalk.dim(
			`\nTokens: ${input.toLocaleString()} in / ${output.toLocaleString()} out | est. cost: $${cost.toFixed(4)}\n`,
		),
	);
}

function formatArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	const parts: string[] = [];
	for (const [key, value] of Object.entries(record)) {
		if (value === undefined) continue;
		const str = typeof value === "string" ? value : JSON.stringify(value);
		parts.push(`${key}: ${str.length > 60 ? `${str.slice(0, 57)}...` : str}`);
	}
	return parts.join(", ");
}

function extractText(result: unknown): string {
	if (!result || typeof result !== "object") return String(result);
	const content = (result as { content?: { type: string; text?: string }[] }).content;
	if (Array.isArray(content)) {
		return content
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text)
			.join("\n");
	}
	return JSON.stringify(result);
}
