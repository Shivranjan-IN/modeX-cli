import type { AssistantMessage, Model } from "@modex/ai";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import type {
	AfterToolCallHook,
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentLoopTurnUpdate,
	AgentMessage,
	AgentOptions,
	AgentState,
	AgentTool,
	BeforeToolCallHook,
	FinishTurn,
	PrepareNextTurnContext,
	PrepareRequest,
	QueueMode,
	StreamFn,
	ThinkingBudgets,
	ThinkingLevel,
	ToolExecutionMode,
	Transport,
} from "./types.js";

const DEFAULT_MODEL: Model = {
	id: "unknown",
	api: "openai-completions",
	provider: "unknown",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 0,
	maxTokens: 0,
};

function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
	return messages.filter(
		(m) => m.role === "system" || m.role === "user" || m.role === "assistant" || m.role === "toolResult",
	);
}

type MutableAgentState = {
	systemPrompt: string;
	model: Model;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool[];
	messages: AgentMessage[];
	isStreaming: boolean;
	streamingMessage?: AgentMessage;
	pendingToolCalls: Set<string>;
	errorMessage?: string;
};

class PendingMessageQueue {
	private messages: AgentMessage[] = [];
	public mode: QueueMode;

	constructor(mode: QueueMode) {
		this.mode = mode;
	}

	enqueue(message: AgentMessage): void {
		this.messages.push(message);
	}

	hasItems(): boolean {
		return this.messages.length > 0;
	}

	peek(): AgentMessage[] {
		if (this.mode === "all") return this.messages.slice();
		const first = this.messages[0];
		return first ? [first] : [];
	}

	drain(): AgentMessage[] {
		const drained = this.peek();
		this.messages = this.messages.slice(drained.length);
		return drained;
	}

	clear(): void {
		this.messages = [];
	}
}

type ActiveRun = {
	promise: Promise<void>;
	resolve: () => void;
	abortController: AbortController;
};

export class Agent {
	private readonly state_: MutableAgentState;
	private readonly listeners = new Set<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>();
	private readonly steeringQueue: PendingMessageQueue;
	private readonly followUpQueue: PendingMessageQueue;
	private activeRun?: ActiveRun;

	public readonly streamFn: StreamFn;
	public readonly convertToLlm: (messages: AgentMessage[]) => AgentMessage[] | Promise<AgentMessage[]>;
	public readonly transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	public readonly getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	public readonly onPayload?: AgentLoopConfig["onPayload"];
	public readonly onResponse?: AgentLoopConfig["onResponse"];
	public readonly onProviderStreamEvent?: AgentLoopConfig["onProviderStreamEvent"];
	public readonly beforeToolCall?: BeforeToolCallHook;
	public readonly afterToolCall?: AfterToolCallHook;
	public readonly finishTurn?: FinishTurn;
	public readonly prepareRequest?: PrepareRequest;
	public readonly prepareNextTurn?: (
		context: PrepareNextTurnContext,
		signal?: AbortSignal,
	) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
	public readonly sessionId?: string;
	public readonly thinkingBudgets?: ThinkingBudgets;
	public readonly transport: Transport;
	public readonly maxRetryDelayMs?: number;
	public readonly toolExecution: ToolExecutionMode;

	constructor(options: AgentOptions) {
		this.state_ = {
			systemPrompt: options.initialState?.systemPrompt ?? "",
			model: options.initialState?.model ?? DEFAULT_MODEL,
			thinkingLevel: options.initialState?.thinkingLevel ?? "off",
			tools: options.initialState?.tools?.slice() ?? [],
			messages: options.initialState?.messages?.slice() ?? [],
			isStreaming: false,
			streamingMessage: undefined,
			pendingToolCalls: new Set<string>(),
			errorMessage: undefined,
		};
		this.streamFn = options.streamFn;
		this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
		this.transformContext = options.transformContext;
		this.getApiKey = options.getApiKey;
		this.onPayload = options.onPayload;
		this.onResponse = options.onResponse;
		this.onProviderStreamEvent = options.onProviderStreamEvent;
		this.beforeToolCall = options.beforeToolCall;
		this.afterToolCall = options.afterToolCall;
		this.finishTurn = options.finishTurn;
		this.prepareRequest = options.prepareRequest;
		this.prepareNextTurn = options.prepareNextTurn;
		this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
		this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
		this.sessionId = options.sessionId;
		this.thinkingBudgets = options.thinkingBudgets;
		this.transport = options.transport ?? "auto";
		this.maxRetryDelayMs = options.maxRetryDelayMs;
		this.toolExecution = options.toolExecution ?? "parallel";
	}

	subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	get state(): AgentState {
		const self = this;
		return {
			get systemPrompt() {
				return self.state_.systemPrompt;
			},
			get model() {
				return self.state_.model;
			},
			set model(m: Model) {
				self.state_.model = m;
			},
			get thinkingLevel() {
				return self.state_.thinkingLevel;
			},
			set thinkingLevel(level: ThinkingLevel) {
				self.state_.thinkingLevel = level;
			},
			get tools() {
				return self.state_.tools;
			},
			set tools(tools: AgentTool[]) {
				self.state_.tools = tools.slice();
			},
			get messages() {
				return self.state_.messages;
			},
			set messages(messages: AgentMessage[]) {
				self.state_.messages = messages.slice();
			},
			get isStreaming() {
				return self.state_.isStreaming;
			},
			get streamingMessage() {
				return self.state_.streamingMessage;
			},
			get pendingToolCalls() {
				return self.state_.pendingToolCalls;
			},
			get errorMessage() {
				return self.state_.errorMessage;
			},
		};
	}

	set steeringMode(mode: QueueMode) {
		this.steeringQueue.mode = mode;
	}

	get steeringMode(): QueueMode {
		return this.steeringQueue.mode;
	}

	set followUpMode(mode: QueueMode) {
		this.followUpQueue.mode = mode;
	}

	get followUpMode(): QueueMode {
		return this.followUpQueue.mode;
	}

	steer(message: AgentMessage): void {
		this.steeringQueue.enqueue(message);
	}

	followUp(message: AgentMessage): void {
		this.followUpQueue.enqueue(message);
	}

	clearSteeringQueue(): void {
		this.steeringQueue.clear();
	}

	clearFollowUpQueue(): void {
		this.followUpQueue.clear();
	}

	clearAllQueues(): void {
		this.clearSteeringQueue();
		this.clearFollowUpQueue();
	}

	hasQueuedMessages(): boolean {
		return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
	}

	peekQueuedMessages(): AgentMessage[] {
		const steering = this.steeringQueue.peek();
		return steering.length > 0 ? steering : this.followUpQueue.peek();
	}

	get signal(): AbortSignal | undefined {
		return this.activeRun?.abortController.signal;
	}

	abort(): void {
		this.activeRun?.abortController.abort();
	}

	async waitForIdle(): Promise<void> {
		await this.activeRun?.promise;
	}

	reset(): void {
		if (this.activeRun) {
			throw new Error("Agent is already processing. Wait for completion before resetting.");
		}
		this.state_.messages = [];
		this.state_.isStreaming = false;
		this.state_.streamingMessage = undefined;
		this.state_.pendingToolCalls = new Set<string>();
		this.state_.errorMessage = undefined;
		this.clearAllQueues();
	}

	async prompt(message: AgentMessage | AgentMessage[]): Promise<void> {
		if (this.activeRun) {
			throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages.");
		}
		const messages = Array.isArray(message) ? message : [message];
		await this.runLifecycle(async (signal) => {
			await runAgentLoop(
				messages,
				this.contextSnapshot(),
				this.loopConfig(),
				(event) => this.processEvents(event),
				signal,
				this.streamFn,
			);
		});
	}

	async continue(): Promise<void> {
		if (this.activeRun) {
			throw new Error("Agent is already processing. Wait for completion before continuing.");
		}
		await this.runLifecycle(async (signal) => {
			await runAgentLoopContinue(
				this.contextSnapshot(),
				this.loopConfig(),
				(event) => this.processEvents(event),
				signal,
				this.streamFn,
			);
		});
	}

	private contextSnapshot(): AgentContext {
		return {
			messages: this.state_.messages.slice(),
			tools: this.state_.tools.slice(),
		};
	}

	private loopConfig(): AgentLoopConfig {
		return {
			model: this.state_.model,
			thinkingLevel: this.state_.thinkingLevel,
			sessionId: this.sessionId,
			onPayload: this.onPayload,
			onResponse: this.onResponse,
			onProviderStreamEvent: this.onProviderStreamEvent,
			transport: this.transport,
			thinkingBudgets: this.thinkingBudgets,
			maxRetryDelayMs: this.maxRetryDelayMs,
			toolExecution: this.toolExecution,
			beforeToolCall: this.beforeToolCall,
			afterToolCall: this.afterToolCall,
			finishTurn: this.finishTurn,
			prepareRequest: this.prepareRequest,
			prepareNextTurn: this.prepareNextTurn
				? (context: PrepareNextTurnContext) => this.prepareNextTurn?.(context, this.signal)
				: undefined,
			convertToLlm: this.convertToLlm,
			transformContext: this.transformContext,
			getApiKey: this.getApiKey,
			getSteeringMessages: async () => this.steeringQueue.drain(),
			getFollowUpMessages: async () => this.followUpQueue.drain(),
		};
	}

	private async runLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (this.activeRun) {
			throw new Error("Agent is already processing.");
		}

		const abortController = new AbortController();
		let resolvePromise = () => {};
		const promise = new Promise<void>((resolve) => {
			resolvePromise = resolve;
		});
		this.activeRun = { promise, resolve: resolvePromise, abortController };

		this.state_.isStreaming = true;
		this.state_.streamingMessage = undefined;
		this.state_.errorMessage = undefined;

		try {
			await executor(abortController.signal);
		} catch (error) {
			await this.handleRunFailure(error, abortController.signal.aborted);
		} finally {
			this.finishRun();
		}
	}

	private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
		const failureMessage: AssistantMessage = {
			role: "assistant",
			content: [],
			api: this.state_.model.api,
			provider: this.state_.model.provider,
			model: this.state_.model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
			stopReason: aborted ? "aborted" : "error",
			errorMessage: error instanceof Error ? error.message : String(error),
			timestamp: Date.now(),
		};
		this.state_.errorMessage = failureMessage.errorMessage;
		await this.processEvents({ type: "message_start", message: failureMessage });
		await this.processEvents({ type: "message_end", message: failureMessage });
	}

	private finishRun(): void {
		this.state_.isStreaming = false;
		this.state_.streamingMessage = undefined;
		this.state_.pendingToolCalls = new Set<string>();
		const run = this.activeRun;
		this.activeRun = undefined;
		run?.resolve();
	}

	private async processEvents(event: AgentEvent): Promise<void> {
		switch (event.type) {
			case "message_start":
				this.state_.streamingMessage = event.message;
				break;
			case "message_update":
				this.state_.streamingMessage = event.message;
				break;
			case "message_end":
				this.state_.streamingMessage = undefined;
				this.state_.messages.push(event.message);
				break;
			case "tool_execution_start": {
				const pending = new Set(this.state_.pendingToolCalls);
				pending.add(event.toolCallId);
				this.state_.pendingToolCalls = pending;
				break;
			}
			case "tool_execution_end": {
				const pending = new Set(this.state_.pendingToolCalls);
				pending.delete(event.toolCallId);
				this.state_.pendingToolCalls = pending;
				break;
			}
			case "turn_end":
				if (event.message.role === "assistant" && event.message.errorMessage) {
					this.state_.errorMessage = event.message.errorMessage;
				}
				break;
			case "agent_end":
				this.state_.streamingMessage = undefined;
				break;
		}

		const signal = this.activeRun?.abortController.signal;
		if (!signal) {
			throw new Error("Agent listener invoked outside active run");
		}
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}
}
