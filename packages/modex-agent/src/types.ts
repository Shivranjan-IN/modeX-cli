import type {
	ApiStreamOptions,
	AssistantMessage,
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	ToolDeclaration,
	ToolResultMessage,
	TranscriptContext,
	Usage,
} from "@modex/ai";

export type StreamFn = (
	model: Model,
	context: TranscriptContext,
	options?: ApiStreamOptions,
) => ReturnType<import("@modex/ai").Provider["stream"]> | Promise<ReturnType<import("@modex/ai").Provider["stream"]>>;

export type ToolExecutionMode = "sequential" | "parallel";

export type QueueMode = "all" | "one-at-a-time";

export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

export interface Tool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface BeforeToolCallResult {
	block?: boolean;
	reason?: string;
	terminate?: boolean;
}

export interface AfterToolCallResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
	usage?: Usage;
	terminate?: boolean;
}

export interface BeforeToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	args: unknown;
	context: AgentContext;
}

export interface AfterToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	args: unknown;
	result: AgentToolResult;
	isError: boolean;
	context: AgentContext;
}

export interface AgentTurnContext {
	message: AssistantMessage;
	toolResults: ToolResultMessage[];
	context: AgentContext;
	newMessages: AgentMessage[];
}

export type AgentTurnDecision = { action: "continue" } | { action: "end" };

export type FinishTurn = (
	turn: AgentTurnContext,
	signal?: AbortSignal,
) => AgentTurnDecision | void | Promise<AgentTurnDecision | undefined> | Promise<void>;

export interface AgentLoopTurnUpdate {
	context?: AgentContext;
	model?: Model;
	thinkingLevel?: ThinkingLevel;
}

export interface PrepareRequestContext {
	context: AgentContext;
	model: Model;
	thinkingLevel: ThinkingLevel;
}

export type AgentRequestUpdate = Omit<AgentLoopTurnUpdate, "context">;

export type PrepareRequest = (
	request: PrepareRequestContext,
	signal?: AbortSignal,
) => AgentRequestUpdate | void | Promise<AgentRequestUpdate | undefined> | Promise<void>;

export type PrepareNextTurnContext = AgentTurnContext;

export interface AgentLoopConfig extends ApiStreamOptions {
	model: Model;
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	finishTurn?: FinishTurn;
	prepareRequest?: PrepareRequest;
	prepareNextTurn?: (
		context: PrepareNextTurnContext,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;
	getSteeringMessages?: () => Promise<AgentMessage[]>;
	getFollowUpMessages?: () => Promise<AgentMessage[]>;
	toolExecution?: ToolExecutionMode;
	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
	sessionId?: string;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ThinkingBudgets {
	thinking?: number;
	thinkingPerTurn?: number;
}

export type Transport = "auto" | "http" | "websocket";

export type AgentMessage = Message;

export interface AgentState {
	readonly systemPrompt: string;
	model: Model;
	thinkingLevel: ThinkingLevel;
	set tools(tools: AgentTool[]);
	get tools(): AgentTool[];
	set messages(messages: AgentMessage[]);
	get messages(): AgentMessage[];
	readonly isStreaming: boolean;
	readonly streamingMessage?: AgentMessage;
	readonly pendingToolCalls: ReadonlySet<string>;
	readonly errorMessage?: string;
}

export interface AgentToolResult<T = unknown> {
	content: (TextContent | ImageContent)[];
	details: T;
	isError?: boolean;
	terminate?: boolean;
}

export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

export interface AgentTool<TDetails = any> extends Tool {
	label: string;
	execute: (
		toolCallId: string,
		params: any,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
	replay?: "never" | "safe";
	executionMode?: ToolExecutionMode;
}

export function toToolDeclaration(tool: AgentTool): ToolDeclaration {
	return {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	};
}

export interface AgentContext {
	messages: AgentMessage[];
	tools?: AgentTool[];
}

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: ToolResultMessage;
			isError: boolean;
			durationMs?: number;
	  };

export interface AgentOptions {
	streamFn: StreamFn;
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	onPayload?: SimpleStreamOptions["onPayload"];
	onResponse?: SimpleStreamOptions["onResponse"];
	onProviderStreamEvent?: SimpleStreamOptions["onProviderStreamEvent"];
	beforeToolCall?: BeforeToolCallHook;
	afterToolCall?: AfterToolCallHook;
	finishTurn?: FinishTurn;
	prepareRequest?: PrepareRequest;
	prepareNextTurn?: (
		context: PrepareNextTurnContext,
		signal?: AbortSignal,
	) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
	steeringMode?: QueueMode;
	followUpMode?: QueueMode;
	sessionId?: string;
	thinkingBudgets?: ThinkingBudgets;
	transport?: Transport;
	maxRetryDelayMs?: number;
	toolExecution?: ToolExecutionMode;
	initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
}

export type BeforeToolCallHook = (
	context: BeforeToolCallContext,
	signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;
export type AfterToolCallHook = (
	context: AfterToolCallContext,
	signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined>;
