import { describe, expect, it } from "vitest";
import { OpenAIChunkAccumulator } from "../src/providers/openai-compatible.js";
import { createAssistantMessageStream } from "../src/providers/stream.js";
import type { AssistantMessageEvent, Model, ToolResultMessage } from "../src/types.js";

const testModel: Model = {
	id: "test-model",
	api: "openai-completions",
	provider: "test",
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
};

async function collectEvents(run: (acc: OpenAIChunkAccumulator) => void): Promise<{
	events: AssistantMessageEvent[];
	message: AssistantMessage;
}> {
	const stream = createAssistantMessageStream();
	const acc = new OpenAIChunkAccumulator(testModel, "test", stream);
	const events: AssistantMessageEvent[] = [];
	const collect = (async () => {
		for await (const event of stream) {
			events.push(event);
		}
	})();
	run(acc);
	acc.finalizeFromStreamEnd();
	const message = await stream.result();
	await collect;
	return { events, message };
}

describe("OpenAIChunkAccumulator", () => {
	it("accumulates streamed text into a single assistant message", async () => {
		const { events, message } = await collectEvents((acc) => {
			acc.handleChunk({ choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] });
			acc.handleChunk({ choices: [{ index: 0, delta: { content: "lo" } }] });
			acc.handleChunk({ choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }] });
		});

		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(events.some((e) => e.type === "start")).toBe(true);
		expect(events.filter((e) => e.type === "text_delta")).toHaveLength(3);
		expect(events.at(-1)?.type).toBe("done");
	});

	it("accumulates streamed tool calls and parses arguments", async () => {
		const { message } = await collectEvents((acc) => {
			acc.handleChunk({
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: '{"pa' } }],
						},
					},
				],
			});
			acc.handleChunk({
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [{ index: 0, function: { arguments: 'th":"file.txt"}' } }],
						},
						finish_reason: "tool_calls",
					},
				],
			});
		});

		expect(message.stopReason).toBe("tool_calls");
		const toolCall = message.content.find((c) => c.type === "toolCall");
		expect(toolCall).toBeDefined();
		expect(toolCall).toMatchObject({ id: "call_1", name: "read", arguments: { path: "file.txt" } });
	});

	it("tracks usage and computes cost", async () => {
		const { message } = await collectEvents((acc) => {
			acc.handleChunk({
				choices: [{ index: 0, delta: { content: "hi" } }],
				usage: { prompt_tokens: 1000000, completion_tokens: 500000 },
			});
			acc.handleChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
		});

		expect(message.usage.input).toBe(1000000);
		expect(message.usage.output).toBe(500000);
		expect(message.usage.totalTokens).toBe(1500000);
		expect(message.usage.cost.input).toBe(1);
		expect(message.usage.cost.output).toBe(1);
	});

	it("finalizes from stream end without finish_reason", async () => {
		const { message, events } = await collectEvents((acc) => {
			acc.handleChunk({ choices: [{ index: 0, delta: { content: "partial" } }] });
		});
		expect(message.stopReason).toBe("stop");
		expect(events.at(-1)?.type).toBe("done");
	});
});

describe("message conversion", () => {
	it("converts all message roles to OpenAI format", async () => {
		const { convertMessagesToOpenAI } = await import("../src/providers/openai-compatible.js");
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "read",
			content: [{ type: "text", text: "file contents" }],
			timestamp: Date.now(),
		};
		const converted = convertMessagesToOpenAI([
			{ role: "system", content: "You are helpful" },
			{ role: "user", content: [{ type: "text", text: "hi" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "let me read" },
					{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } },
				],
				api: "openai-completions",
				provider: "test",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
				stopReason: "tool_calls",
				timestamp: Date.now(),
			},
			toolResult,
		]);

		expect(converted).toHaveLength(4);
		expect(converted[0]).toEqual({ role: "system", content: "You are helpful" });
		expect(converted[1]).toEqual({ role: "user", content: "hi" });
		const assistant = converted[2] as any;
		expect(assistant.role).toBe("assistant");
		expect(assistant.tool_calls).toHaveLength(1);
		expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ path: "a.txt" });
		expect(converted[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "file contents" });
	});
});
