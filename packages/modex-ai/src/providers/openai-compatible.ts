import { ModelsError } from "../errors.js";
import type {
	ApiStreamOptions,
	AssistantContentBlock,
	AssistantMessage,
	AssistantMessageEventStream,
	Model,
	Provider,
	SystemMessage,
	TextContent,
	ToolCall,
	ToolDeclaration,
	ToolResultMessage,
	TranscriptContext,
	Usage,
	UserMessage,
} from "../types.js";
import { createAssistantMessageStream } from "./stream.js";

export interface OpenAICompatibleProviderOptions {
	id: string;
	name: string;
	baseUrl: string;
	envKey?: string;
	models: Model[];
}

interface OpenAIFunctionToolCall {
	index: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

interface OpenAIChatChunk {
	id?: string;
	choices?: {
		index?: number;
		delta?: {
			role?: string;
			content?: string | null;
			reasoning_content?: string | null;
			reasoning?: string | null;
			tool_calls?: OpenAIFunctionToolCall[];
		};
		finish_reason?: string | null;
	}[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number };
	};
	error?: { message?: string; code?: string };
}

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function computeCost(
	model: Model,
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
): Usage["cost"] {
	const perMillion = 1_000_000;
	return {
		input: (usage.input / perMillion) * model.cost.input,
		output: (usage.output / perMillion) * model.cost.output,
		cacheRead: (usage.cacheRead / perMillion) * model.cost.cacheRead,
		cacheWrite: (usage.cacheWrite / perMillion) * model.cost.cacheWrite,
	};
}

function mapFinishReason(reason: string | null | undefined): AssistantMessage["stopReason"] {
	switch (reason) {
		case "stop":
		case "end_turn":
			return "stop";
		case "length":
			return "length";
		case "tool_calls":
		case "function_call":
			return "tool_calls";
		default:
			return "stop";
	}
}

export function convertMessagesToOpenAI(messages: TranscriptContext["messages"]): unknown[] {
	const out: unknown[] = [];
	for (const message of messages) {
		switch (message.role) {
			case "system": {
				const sys = message as SystemMessage;
				out.push({ role: "system", content: sys.content });
				break;
			}
			case "user": {
				const user = message as UserMessage;
				const hasImages = user.content.some((c) => c.type === "image");
				if (hasImages) {
					out.push({
						role: "user",
						content: user.content.map((c) =>
							c.type === "text"
								? { type: "text", text: c.text }
								: { type: "image_url", image_url: { url: `data:${c.mimeType};base64,${c.data}` } },
						),
					});
				} else {
					out.push({ role: "user", content: user.content.map((c) => (c.type === "text" ? c.text : "")).join("") });
				}
				break;
			}
			case "assistant": {
				const text = message.content
					.filter((c): c is TextContent => c.type === "text")
					.map((c) => c.text)
					.join("");
				const toolCalls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
				const entry: Record<string, unknown> = { role: "assistant", content: text || null };
				if (toolCalls.length > 0) {
					entry.tool_calls = toolCalls.map((tc) => ({
						id: tc.id,
						type: "function",
						function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
					}));
				}
				out.push(entry);
				break;
			}
			case "toolResult": {
				const result = message as ToolResultMessage;
				const text = result.content
					.filter((c): c is TextContent => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				out.push({ role: "tool", tool_call_id: result.toolCallId, content: text });
				break;
			}
		}
	}
	return out;
}

export function buildOpenAIPayload(
	model: Model,
	context: TranscriptContext,
	options?: ApiStreamOptions,
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		model: model.id,
		messages: convertMessagesToOpenAI(context.messages),
		stream: true,
	};

	if (options?.tools && options.tools.length > 0) {
		payload.tools = options.tools.map((tool: ToolDeclaration) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
		payload.tool_choice = "auto";
	}

	if (options?.maxOutputTokens && options.maxOutputTokens > 0) {
		payload.max_tokens = options.maxOutputTokens;
	}

	return payload;
}

export class OpenAIChunkAccumulator {
	private readonly model: Model;
	private readonly providerId: string;
	private readonly stream: ReturnType<typeof createAssistantMessageStream>;
	private readonly blocks: AssistantContentBlock[] = [];
	private readonly rawToolArgs = new Map<number, { id: string; name: string; raw: string }>();
	private textOpen = false;
	private thinkingOpen = false;
	private started = false;
	private finalized = false;
	private lastFinishReason: string | null = null;
	private readonly numericUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

	constructor(model: Model, providerId: string, stream: ReturnType<typeof createAssistantMessageStream>) {
		this.model = model;
		this.providerId = providerId;
		this.stream = stream;
	}

	private currentPartial(extra?: Partial<AssistantMessage>): AssistantMessage {
		return {
			role: "assistant",
			content: this.blocks.map((b) => ({ ...b })),
			api: this.model.api,
			provider: this.providerId,
			model: this.model.id,
			usage: this.currentUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
			...extra,
		};
	}

	private currentUsage(): Usage {
		return {
			...this.numericUsage,
			totalTokens: this.numericUsage.input + this.numericUsage.output,
			cost: computeCost(this.model, this.numericUsage),
		};
	}

	private ensureStarted(): void {
		if (this.started) return;
		this.started = true;
		this.stream.push({ type: "start", partial: this.currentPartial() });
	}

	handleChunk(chunk: OpenAIChatChunk): void {
		if (chunk.error) {
			throw new ModelsError("provider_error", chunk.error.message ?? "Provider returned error in stream");
		}

		this.ensureStarted();

		if (chunk.usage) {
			this.numericUsage.input = chunk.usage.prompt_tokens ?? this.numericUsage.input;
			this.numericUsage.output = chunk.usage.completion_tokens ?? this.numericUsage.output;
			this.numericUsage.cacheRead = chunk.usage.prompt_tokens_details?.cached_tokens ?? this.numericUsage.cacheRead;
		}

		const choice = chunk.choices?.[0];
		if (!choice) return;
		const delta = choice.delta;

		if (delta?.reasoning_content || delta?.reasoning) {
			const text = delta.reasoning_content ?? delta.reasoning ?? "";
			if (!this.thinkingOpen) {
				this.closeText();
				this.thinkingOpen = true;
				this.blocks.push({ type: "thinking", thinking: "" });
				this.stream.push({ type: "thinking_start", partial: this.currentPartial() });
			}
			const block = this.blocks[this.blocks.length - 1];
			if (block.type === "thinking") block.thinking += text;
			this.stream.push({ type: "thinking_delta", delta: text, partial: this.currentPartial() });
		}

		if (typeof delta?.content === "string" && delta.content.length > 0) {
			if (!this.textOpen) {
				this.closeThinking();
				this.textOpen = true;
				this.blocks.push({ type: "text", text: "" });
				this.stream.push({ type: "text_start", partial: this.currentPartial() });
			}
			const block = this.blocks[this.blocks.length - 1];
			if (block.type === "text") block.text += delta.content;
			this.stream.push({ type: "text_delta", delta: delta.content, partial: this.currentPartial() });
		}

		if (delta?.tool_calls) {
			this.closeText();
			this.closeThinking();
			for (const tc of delta.tool_calls) {
				let entry = this.rawToolArgs.get(tc.index);
				if (!entry) {
					const id = tc.id ?? `call_${tc.index}_${Date.now()}`;
					const name = tc.function?.name ?? "";
					entry = { id, name, raw: "" };
					this.rawToolArgs.set(tc.index, entry);
					const toolCall: ToolCall = { type: "toolCall", id, name, arguments: {} };
					this.blocks.push(toolCall);
					this.stream.push({
						type: "toolcall_start",
						toolCall: { ...toolCall },
						partial: this.currentPartial(),
					});
				}
				if (tc.id) entry.id = tc.id;
				if (tc.function?.name) entry.name = tc.function.name;
				if (tc.function?.arguments) {
					entry.raw += tc.function.arguments;
					this.stream.push({
						type: "toolcall_delta",
						delta: tc.function.arguments,
						partial: this.currentPartial(),
					});
				}
			}
		}

		if (choice.finish_reason) {
			this.lastFinishReason = choice.finish_reason;
			this.finalize(choice.finish_reason);
		}
	}

	finalizeFromStreamEnd(): void {
		if (this.finalized) return;
		this.ensureStarted();
		this.finalize(this.lastFinishReason);
	}

	private closeText(): void {
		if (!this.textOpen) return;
		this.textOpen = false;
		this.stream.push({ type: "text_end", partial: this.currentPartial() });
	}

	private closeThinking(): void {
		if (!this.thinkingOpen) return;
		this.thinkingOpen = false;
		this.stream.push({ type: "thinking_end", partial: this.currentPartial() });
	}

	private finalize(finishReason: string | null | undefined): void {
		if (this.finalized) return;
		this.finalized = true;
		this.closeText();
		this.closeThinking();

		for (const [, entry] of this.rawToolArgs) {
			const block = this.blocks.find((b): b is ToolCall => b.type === "toolCall" && b.id === entry.id);
			if (!block) continue;
			block.name = entry.name;
			try {
				block.arguments = entry.raw.trim() ? JSON.parse(entry.raw) : {};
			} catch {
				block.arguments = { __raw: entry.raw };
			}
			this.stream.push({
				type: "toolcall_end",
				toolCall: { ...block },
				partial: this.currentPartial(),
			});
		}

		const message = this.currentPartial({ stopReason: mapFinishReason(finishReason) });
		this.stream.end(message);
	}

	failWith(errorMessage: string, aborted = false): void {
		this.closeText();
		this.closeThinking();
		const message = this.currentPartial({
			stopReason: aborted ? "aborted" : "error",
			errorMessage,
		});
		this.stream.fail(message);
	}
}

export class OpenAICompatibleProvider implements Provider {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly envKey?: string;
	private readonly models: Model[];

	constructor(options: OpenAICompatibleProviderOptions) {
		this.id = options.id;
		this.name = options.name;
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.envKey = options.envKey;
		this.models = options.models;
	}

	getModels(): readonly Model[] {
		return this.models;
	}

	stream(model: Model, context: TranscriptContext, options?: ApiStreamOptions): AssistantMessageEventStream {
		const stream = createAssistantMessageStream();
		void this.run(model, context, options, stream);
		return stream;
	}

	private async run(
		model: Model,
		context: TranscriptContext,
		options: ApiStreamOptions | undefined,
		stream: ReturnType<typeof createAssistantMessageStream>,
	): Promise<void> {
		const apiKey = options?.apiKey ?? (this.envKey ? process.env[this.envKey] : undefined);
		if (!apiKey) {
			stream.fail(
				this.errorMessage(
					model,
					`Missing API key for provider ${this.id}. Set ${this.envKey ?? "the provider API key"}.`,
				),
			);
			return;
		}

		const payload = buildOpenAIPayload(model, context, options);
		options?.onPayload?.(payload);

		const headers: Record<string, string> = {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
			...model.headers,
			...options?.headers,
		};

		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			});
		} catch (error) {
			if (options?.signal?.aborted) {
				stream.fail(this.errorMessage(model, "Request aborted", true));
				return;
			}
			stream.fail(this.errorMessage(model, error instanceof Error ? error.message : String(error)));
			return;
		}

		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});
		options?.onResponse?.({ status: response.status, headers: responseHeaders }, model);

		if (!response.ok) {
			let detail = "";
			try {
				detail = await response.text();
			} catch {
				detail = response.statusText;
			}
			stream.fail(
				this.errorMessage(model, `Provider ${this.id} returned HTTP ${response.status}: ${detail.slice(0, 500)}`),
			);
			return;
		}

		if (!response.body) {
			stream.fail(this.errorMessage(model, "Provider returned empty body"));
			return;
		}

		const accumulator = new OpenAIChunkAccumulator(model, this.id, stream);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let sawDone = false;

		try {
			while (!sawDone) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() ?? "";
				for (const rawLine of lines) {
					const line = rawLine.trim();
					if (!line.startsWith("data:")) continue;
					const data = line.slice(5).trim();
					if (data === "[DONE]") {
						sawDone = true;
						break;
					}
					let chunk: OpenAIChatChunk;
					try {
						chunk = JSON.parse(data);
					} catch {
						continue;
					}
					options?.onProviderStreamEvent?.(chunk);
					accumulator.handleChunk(chunk);
				}
			}
		} catch (error) {
			if (options?.signal?.aborted) {
				accumulator.failWith("Request aborted", true);
				return;
			}
			accumulator.failWith(error instanceof Error ? error.message : String(error));
			return;
		}

		accumulator.finalizeFromStreamEnd();
	}

	private errorMessage(model: Model, text: string, aborted = false): AssistantMessage {
		return {
			role: "assistant",
			content: [],
			api: model.api,
			provider: this.id,
			model: model.id,
			usage: EMPTY_USAGE,
			stopReason: aborted ? "aborted" : "error",
			errorMessage: text,
			timestamp: Date.now(),
		};
	}
}
