import type { AssistantMessage, ToolCall, ToolResultMessage } from "@modex/ai";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolResult,
	StreamFn,
} from "./types.js";
import { toToolDeclaration } from "./types.js";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...prompts],
		tools: context.tools ?? [],
	};

	for (const message of prompts) {
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
	}

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });

	let loopConfig = config;
	let continueLoop = true;

	while (continueLoop) {
		continueLoop = false;

		const requestUpdate = await loopConfig.prepareRequest?.(
			{
				context: currentContext,
				model: loopConfig.model,
				thinkingLevel: loopConfig.thinkingLevel ?? "off",
			},
			signal,
		);
		if (requestUpdate) {
			loopConfig = { ...loopConfig, ...requestUpdate };
		}

		const message = await streamAssistantResponse(currentContext, loopConfig, signal, emit, streamFn);
		newMessages.push(message);

		if (message.stopReason === "error" || message.stopReason === "aborted") {
			await emit({ type: "turn_end", message, toolResults: [] });
			await emit({ type: "agent_end", messages: newMessages });
			return newMessages;
		}

		const toolCalls = message.content.filter((c): c is ToolCall => c.type === "toolCall");

		const toolResults: ToolResultMessage[] = [];
		let terminate = false;
		if (toolCalls.length > 0) {
			const executed = await executeToolCalls(currentContext, message, loopConfig, signal, emit);
			toolResults.push(...executed.messages);
			terminate = executed.terminate;

			for (const result of toolResults) {
				currentContext.messages.push(result);
				newMessages.push(result);
			}
		}

		await emit({ type: "turn_end", message, toolResults });

		const decision = await loopConfig.finishTurn?.(
			{ message, toolResults, context: currentContext, newMessages },
			signal,
		);

		if (terminate || decision?.action === "end") {
			await emit({ type: "agent_end", messages: newMessages });
			return newMessages;
		}

		const steeringMessages = (await loopConfig.getSteeringMessages?.()) ?? [];
		if (steeringMessages.length > 0) {
			for (const msg of steeringMessages) {
				await emit({ type: "message_start", message: msg });
				await emit({ type: "message_end", message: msg });
				currentContext.messages.push(msg);
				newMessages.push(msg);
			}
			continueLoop = true;
			continue;
		}

		if (toolCalls.length > 0) {
			continueLoop = true;
			continue;
		}

		const followUpMessages = (await loopConfig.getFollowUpMessages?.()) ?? [];
		if (followUpMessages.length > 0) {
			for (const msg of followUpMessages) {
				await emit({ type: "message_start", message: msg });
				await emit({ type: "message_end", message: msg });
				currentContext.messages.push(msg);
				newMessages.push(msg);
			}
			continueLoop = true;
		}
	}

	await emit({ type: "agent_end", messages: newMessages });
	return newMessages;
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	const lastMessage = context.messages[context.messages.length - 1];
	if (lastMessage.role === "assistant") {
		throw new Error("Cannot continue from an assistant message; send a user message instead");
	}

	return runAgentLoop([], context, config, emit, signal, streamFn);
}

async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn: StreamFn,
): Promise<AssistantMessage> {
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	const llmMessages = await config.convertToLlm(messages);
	const resolvedApiKey = config.getApiKey ? await config.getApiKey(config.model.provider) : undefined;

	const tools = context.tools ?? [];
	const options = {
		...config,
		apiKey: resolvedApiKey,
		signal,
		tools: tools.length > 0 ? tools.map(toToolDeclaration) : undefined,
	};

	const response = await streamFn(config.model, { messages: llmMessages }, options);

	let partialMessage: AssistantMessage | undefined;
	let addedPartial = false;

	const replacePartial = (next: AssistantMessage) => {
		partialMessage = next;
		if (addedPartial) {
			context.messages[context.messages.length - 1] = next;
		} else {
			context.messages.push(next);
			addedPartial = true;
		}
	};

	for await (const event of response) {
		switch (event.type) {
			case "start": {
				if (event.partial) {
					replacePartial(event.partial);
					await emit({ type: "message_start", message: event.partial });
				}
				break;
			}
			case "text_start":
			case "text_delta":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end": {
				if (event.partial) {
					const partial: AssistantMessage = event.partial;
					const first = !addedPartial;
					replacePartial(partial);
					if (first) {
						await emit({ type: "message_start", message: partial });
					}
					await emit({ type: "message_update", message: partial, assistantMessageEvent: event });
				}
				break;
			}
			case "done":
			case "error": {
				const finalMessage: AssistantMessage | undefined = event.message ?? partialMessage;
				if (!finalMessage) {
					throw new Error(`Stream ended without a message (event: ${event.type})`);
				}
				replacePartial(finalMessage);
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	if (!partialMessage) {
		throw new Error("Stream ended without producing a message");
	}
	await emit({ type: "message_end", message: partialMessage });
	return partialMessage;
}

async function executeToolCalls(
	context: AgentContext,
	assistantMessage: AssistantMessage,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<{ messages: ToolResultMessage[]; terminate: boolean }> {
	const toolCalls = assistantMessage.content.filter((c): c is ToolCall => c.type === "toolCall");
	const results: ToolResultMessage[] = [];
	let terminate = false;
	const tools = context.tools ?? [];
	const sequential = config.toolExecution === "sequential";

	if (sequential) {
		for (const toolCall of toolCalls) {
			if (signal?.aborted) break;
			const outcome = await executeOneToolCall(context, assistantMessage, toolCall, tools, config, signal, emit);
			results.push(outcome.message);
			if (outcome.terminate) terminate = true;
			if (outcome.stop) break;
		}
	} else {
		const outcomes = await Promise.all(
			toolCalls.map((toolCall) =>
				executeOneToolCall(context, assistantMessage, toolCall, tools, config, signal, emit),
			),
		);
		for (const outcome of outcomes) {
			results.push(outcome.message);
			if (outcome.terminate) terminate = true;
		}
	}

	return { messages: results, terminate };
}

async function executeOneToolCall(
	context: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: ToolCall,
	tools: AgentTool[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<{ message: ToolResultMessage; terminate: boolean; stop: boolean }> {
	const start = Date.now();
	await emit({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});

	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		const message = makeToolResult(
			toolCall,
			[{ type: "text", text: `Tool "${toolCall.name}" not found` }],
			true,
			start,
		);
		await emit({
			type: "tool_execution_end",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			result: message,
			isError: true,
		});
		return { message, terminate: false, stop: false };
	}

	if (config.beforeToolCall) {
		const gate = await config.beforeToolCall(
			{ assistantMessage, toolCall, args: toolCall.arguments, context },
			signal,
		);
		if (gate?.block) {
			const message = makeToolResult(
				toolCall,
				[{ type: "text", text: `Tool call blocked${gate.reason ? `: ${gate.reason}` : ""}` }],
				true,
				start,
			);
			await emit({
				type: "tool_execution_end",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				result: message,
				isError: true,
			});
			return { message, terminate: gate.terminate ?? false, stop: false };
		}
		if (gate?.terminate) {
			const message = makeToolResult(
				toolCall,
				[{ type: "text", text: "Tool call terminated by gate" }],
				false,
				start,
			);
			await emit({
				type: "tool_execution_end",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				result: message,
				isError: false,
			});
			return { message, terminate: true, stop: true };
		}
	}

	let result: AgentToolResult;
	try {
		result = await tool.execute(toolCall.id, toolCall.arguments, signal, (partialResult) => {
			void emit({
				type: "tool_execution_update",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args: toolCall.arguments,
				partialResult,
			});
		});
	} catch (error) {
		result = {
			content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
			details: undefined,
			isError: true,
		};
	}

	let message = makeToolResult(toolCall, result.content, result.isError ?? false, start, result.details);

	if (config.afterToolCall) {
		const after = await config.afterToolCall(
			{ assistantMessage, toolCall, args: toolCall.arguments, result, isError: result.isError ?? false, context },
			signal,
		);
		if (after) {
			message = {
				...message,
				content: after.content ?? message.content,
				details: after.details ?? message.details,
				isError: after.isError ?? message.isError,
				usage: after.usage ?? message.usage,
				terminate: after.terminate ?? message.terminate,
			};
		}
	}

	await emit({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result: message,
		isError: message.isError ?? false,
		durationMs: Date.now() - start,
	});

	return { message, terminate: message.terminate ?? false, stop: false };
}

function makeToolResult(
	toolCall: ToolCall,
	content: ToolResultMessage["content"],
	isError: boolean,
	start: number,
	details?: unknown,
): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content,
		details,
		isError,
		durationMs: Date.now() - start,
		timestamp: Date.now(),
	};
}
