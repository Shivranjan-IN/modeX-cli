import { getCatalogModels, PROVIDER_ENDPOINTS } from "./catalog.js";
import { PaidModelBlockedError } from "./errors.js";
import { FreeRouter } from "./free-router.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import type {
	ApiStreamOptions,
	AssistantMessage,
	AssistantMessageEventStream,
	Model,
	Models,
	ModexModel,
	Provider,
	TranscriptContext,
} from "./types.js";

export interface CreateModexModelsOptions {
	env?: Record<string, string>;
	extraModels?: ModexModel[];
	requireExplicitPaidOptIn?: boolean;
}

export interface ModexRuntime {
	models: Models;
	router: FreeRouter;
	providers: Provider[];
	isProviderAvailable: (providerId: string) => boolean;
}

export function createModexModels(options: CreateModexModelsOptions = {}): ModexRuntime {
	const env = options.env ?? process.env;
	const allModels = [...getCatalogModels(), ...(options.extraModels ?? [])];

	const modelsByProvider = new Map<string, ModexModel[]>();
	for (const model of allModels) {
		const list = modelsByProvider.get(model.provider) ?? [];
		list.push(model);
		modelsByProvider.set(model.provider, list);
	}

	const providers: Provider[] = [];
	for (const endpoint of PROVIDER_ENDPOINTS) {
		const models = modelsByProvider.get(endpoint.id);
		if (!models || models.length === 0) continue;
		providers.push(
			new OpenAICompatibleProvider({
				id: endpoint.id,
				name: endpoint.name,
				baseUrl: endpoint.baseUrl,
				envKey: endpoint.envKey,
				models,
			}),
		);
	}

	for (const [providerId, models] of modelsByProvider) {
		if (providers.some((p) => p.id === providerId)) continue;
		const baseUrl = models.find((m) => m.baseUrl)?.baseUrl;
		if (!baseUrl) continue;
		providers.push(
			new OpenAICompatibleProvider({
				id: providerId,
				name: providerId,
				baseUrl,
				envKey: undefined,
				models,
			}),
		);
	}

	const providerMap = new Map(providers.map((p) => [p.id, p]));

	function resolveApiKey(providerId: string, explicit?: string): string | undefined {
		if (explicit) return explicit;
		const endpoint = PROVIDER_ENDPOINTS.find((e) => e.id === providerId);
		if (endpoint) return env[endpoint.envKey];
		return env[`${providerId.toUpperCase()}_API_KEY`];
	}

	function isProviderAvailable(providerId: string): boolean {
		return Boolean(resolveApiKey(providerId));
	}

	const models: Models = {
		getProviders: () => providers,
		getProvider: (id) => providerMap.get(id),
		getModels: (provider) =>
			provider ? (providerMap.get(provider)?.getModels() ?? []) : providers.flatMap((p) => p.getModels()),
		getModel: (provider, id) => models.getModels(provider).find((m) => m.id === id),
		getAllModels: (provider) => (provider ? (modelsByProvider.get(provider) ?? []) : allModels),
		stream(model: Model, context: TranscriptContext, opts?: ApiStreamOptions): AssistantMessageEventStream {
			const provider = providerMap.get(model.provider);
			if (!provider) {
				throw new Error(`Unknown provider: ${model.provider}`);
			}
			const apiKey = resolveApiKey(model.provider, opts?.apiKey);
			return provider.stream(model, context, { ...opts, apiKey });
		},
		async complete(model: Model, context: TranscriptContext, opts?: ApiStreamOptions): Promise<AssistantMessage> {
			const stream = models.stream(model, context, opts);
			return stream.result();
		},
	};

	const router = new FreeRouter({
		models,
		requireExplicitPaidOptIn: options.requireExplicitPaidOptIn ?? true,
		isProviderAvailable,
		maxFallbacksPerRequest: 10,
	});

	return { models, router, providers, isProviderAvailable };
}

export { PaidModelBlockedError };
