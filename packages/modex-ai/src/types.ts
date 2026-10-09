export interface ModelCostRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ModelCost extends ModelCostRates {
	tiers?: ModelCostTier[];
}

export interface ModelCostTier {
	inputTokensAbove: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ModelPromptCache {
	short: number;
	long: number;
}

export interface ModelInputLimits {
	maxRequestBytes?: number;
}

export type ModelType = "chat" | "image" | "classifier";

export type Api =
	| "anthropic-messages"
	| "openai-completions"
	| "openai-responses"
	| "google-generative-ai"
	| "mistral-conversations";

export type KnownProvider =
	| "anthropic"
	| "openai"
	| "google"
	| "mistral"
	| "groq"
	| "cerebras"
	| "together"
	| "fireworks"
	| "openrouter"
	| "nvidia"
	| "deepseek"
	| "xai"
	| "moonshotai";

export interface ProviderHeaders {
	[name: string]: string | undefined;
}

export interface AuthContext {
	env: Record<string, string>;
}

export interface AuthOperationOptions {
	signal?: AbortSignal;
}

export type AuthType = "api_key" | "oauth";

export interface AuthCheck {
	source: string;
	type: AuthType;
}

export interface AuthResult {
	source: string;
	type: AuthType;
	auth: {
		apiKey?: string;
		baseUrl?: string;
		headers?: ProviderHeaders;
	};
}

export interface Credential {
	type: AuthType;
	key?: string;
	access?: string;
	refresh?: string;
	expires?: number;
}

export interface CredentialInfo {
	providerId: string;
	type: AuthType;
}

export interface CredentialStore {
	read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined>;
	list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;
	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined>;
	delete(providerId: string, options?: AuthOperationOptions): Promise<void>;
}

export type ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Model<TApi extends Api = Api> {
	type?: "chat";
	id: string;
	name?: string;
	api: TApi;
	provider: string;
	baseUrl?: string;
	reasoning?: boolean;
	input: ("text" | "image")[];
	inputLimits?: ModelInputLimits;
	compat?: Record<string, unknown>;
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	promptCache?: ModelPromptCache;
	headers?: ProviderHeaders;
}

export type AnyModel = Model<Api>;

export interface ProviderRequestOptions {
	apiKey?: string;
	headers?: ProviderHeaders;
	signal?: AbortSignal;
	sessionId?: string;
	tools?: ToolDeclaration[];
	maxOutputTokens?: number;
}

export interface SimpleStreamOptions extends ProviderRequestOptions {
	onPayload?: (payload: unknown) => void;
	onResponse?: (response: { status: number; headers: Record<string, string> }, model: Model) => void;
	onProviderStreamEvent?: (event: unknown) => void;
}

export interface ApiStreamOptions extends SimpleStreamOptions {
	thinkingLevel?: ModelThinkingLevel;
	thinkingBudgets?: ThinkingBudgets;
	transport?: Transport;
	maxRetryDelayMs?: number;
}

export interface ThinkingBudgets {
	thinking?: number;
	thinkingPerTurn?: number;
}

export type Transport = "auto" | "http" | "websocket";

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: ModelCostRates;
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantContentBlock[];
	api: Api;
	provider: string;
	model: string;
	usage: Usage;
	stopReason: "stop" | "length" | "tool_calls" | "error" | "aborted";
	errorMessage?: string;
	responseId?: string;
	thinkingLevel?: ModelThinkingLevel;
	timestamp: number;
}

export type AssistantContentBlock = TextContent | ThinkingContent | ToolCall;

export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface SystemMessage {
	role: "system";
	content: string;
	timestamp?: number;
}

export interface UserMessage {
	role: "user";
	content: (TextContent | ImageContent)[];
	timestamp?: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: unknown;
	usage?: Usage;
	isError?: boolean;
	terminate?: boolean;
	durationMs?: number;
	timestamp: number;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ToolDeclaration {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface TranscriptContext {
	messages: Message[];
}

export interface AssistantMessageEvent {
	type:
		| "start"
		| "text_start"
		| "text_delta"
		| "text_end"
		| "thinking_start"
		| "thinking_delta"
		| "thinking_end"
		| "toolcall_start"
		| "toolcall_delta"
		| "toolcall_end"
		| "done"
		| "error";
	partial?: AssistantMessage;
	contentIndex?: number;
	delta?: string;
	toolCall?: ToolCall;
	message?: AssistantMessage;
}

export interface AssistantMessageEventStream {
	[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
	push(event: AssistantMessageEvent): void;
	end(message: AssistantMessage): void;
	result(): Promise<AssistantMessage>;
}

export interface Provider {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly envKey?: string;
	getModels(): readonly Model[];
	stream(model: Model, context: TranscriptContext, options?: ApiStreamOptions): AssistantMessageEventStream;
}

export interface ModelsStoreEntry {
	models: Model[];
	checkedAt: number;
}

export interface ModelsStore {
	read(providerId: string, options?: { signal?: AbortSignal }): Promise<ModelsStoreEntry | undefined>;
	write(providerId: string, entry: ModelsStoreEntry, options?: { signal?: AbortSignal }): Promise<void>;
	delete(providerId: string, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface FreeModelMetadata {
	freeEligibility: "free" | "paid" | "unknown" | "trial";
	verifiedAt: string;
	verificationSource: "catalog" | "docs" | "provider-api" | "manual";
	quota?: {
		limit: number;
		window: "day" | "month";
		remaining?: number;
	};
	capabilities: string[];
}

export interface ModexModel extends Model {
	freeMetadata: FreeModelMetadata;
}

export interface ModelsRefreshOptions {
	allowNetwork?: boolean;
	providers?: readonly string[];
	force?: boolean;
	signal?: AbortSignal;
}

export interface ModelsRefreshResult {
	aborted: boolean;
	errors: ReadonlyMap<string, Error>;
}

export interface Models {
	getProviders(): readonly Provider[];
	getProvider(id: string): Provider | undefined;
	getModels(provider?: string): readonly Model[];
	getModel(provider: string, id: string): Model | undefined;
	getAllModels(provider?: string): readonly ModexModel[];
	stream(model: Model, context: TranscriptContext, options?: ApiStreamOptions): AssistantMessageEventStream;
	complete(model: Model, context: TranscriptContext, options?: ApiStreamOptions): Promise<AssistantMessage>;
}
