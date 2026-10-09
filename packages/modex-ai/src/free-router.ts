import { ModelsError, PaidModelBlockedError } from "./errors.js";
import type { Models, ModexModel } from "./types.js";

export interface ModelSelection {
	model: ModexModel;
	reasoning: string;
	fallbacks: ModexModel[];
}

export interface FreeRouterOptions {
	models: Models;
	requireExplicitPaidOptIn?: boolean;
	maxFallbacksPerRequest?: number;
	freeEligibilityMaxAgeDays?: number;
	isProviderAvailable?: (providerId: string) => boolean;
}

export interface UserPreferences {
	provider?: string;
	modelPattern?: string;
	thinkingLevel?: string;
	capabilities?: string[];
}

const FALLBACK_ERRORS = [
	"transient",
	"rate_limit",
	"quota_exceeded",
	"context_overflow",
	"auth_failure",
	"model_not_found",
];

function displayId(model: ModexModel): string {
	return model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
}

export class FreeRouter {
	private readonly models: Models;
	private readonly requireExplicitPaidOptIn: boolean;
	private readonly maxFallbacksPerRequest: number;
	private readonly freeEligibilityMaxAgeMs: number;
	private readonly isProviderAvailable?: (providerId: string) => boolean;
	private readonly fallbackAttempts = new Map<string, Map<string, number>>();

	constructor(options: FreeRouterOptions) {
		this.models = options.models;
		this.requireExplicitPaidOptIn = options.requireExplicitPaidOptIn ?? true;
		this.maxFallbacksPerRequest = options.maxFallbacksPerRequest ?? 3;
		this.freeEligibilityMaxAgeMs = (options.freeEligibilityMaxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
		this.isProviderAvailable = options.isProviderAvailable;
	}

	isFreeEligible(model: ModexModel): boolean {
		const meta = model.freeMetadata;
		if (!meta) return false;
		if (meta.freeEligibility !== "free") return false;
		const age = Date.now() - new Date(meta.verifiedAt).getTime();
		return age < this.freeEligibilityMaxAgeMs;
	}

	getFreeEligibleModels(): ModexModel[] {
		return this.models
			.getAllModels()
			.filter((m) => this.isFreeEligible(m))
			.filter((m) => !this.isProviderAvailable || this.isProviderAvailable(m.provider));
	}

	getPaidModels(): ModexModel[] {
		return this.models
			.getAllModels()
			.filter((m) => m.freeMetadata?.freeEligibility === "paid")
			.filter((m) => !this.isProviderAvailable || this.isProviderAvailable(m.provider));
	}

	async selectModel(userPreferences: UserPreferences, userHasOptedInToPaid: boolean): Promise<ModelSelection> {
		const freeModels = this.getFreeEligibleModels();

		if (freeModels.length === 0) {
			if (!userHasOptedInToPaid && this.requireExplicitPaidOptIn) {
				throw new PaidModelBlockedError({
					message:
						"No free-eligible models are available. Set an API key for a free provider (GROQ_API_KEY, CEREBRAS_API_KEY, ...) or pass --paid to opt in to paid models.",
					availableFreeModels: [],
					availablePaidModels: this.getPaidModels().map(displayId),
				});
			}
			const paidModels = this.getPaidModels();
			if (paidModels.length === 0) {
				throw new ModelsError("no_models", "No models available at all");
			}
			return this.selectFromModels(paidModels, userPreferences, "paid (no free models available)");
		}

		let candidates = freeModels;

		if (userPreferences.provider) {
			candidates = candidates.filter((m) => m.provider === userPreferences.provider);
		}

		if (userPreferences.modelPattern) {
			const pattern = userPreferences.modelPattern.toLowerCase();
			const matched = candidates.filter(
				(m) => m.id.toLowerCase().includes(pattern) || (m.name?.toLowerCase().includes(pattern) ?? false),
			);
			if (matched.length > 0) {
				candidates = matched;
			} else if (!userHasOptedInToPaid && this.requireExplicitPaidOptIn) {
				throw new PaidModelBlockedError({
					message: `No free model matches "${userPreferences.modelPattern}". Pass --paid to allow paid models.`,
					availableFreeModels: freeModels.map(displayId),
					availablePaidModels: this.getPaidModels().map(displayId),
				});
			} else {
				const paidMatches = this.getPaidModels().filter(
					(m) =>
						m.id.toLowerCase().includes(pattern) ||
						(m.name?.toLowerCase().includes(pattern) ?? false) ||
						!userPreferences.provider ||
						m.provider === userPreferences.provider,
				);
				if (paidMatches.length === 0) {
					throw new ModelsError("no_matching_free_models", `No model matches "${userPreferences.modelPattern}"`);
				}
				return this.selectFromModels(paidMatches, userPreferences, "paid (explicit --paid opt-in)");
			}
		}

		if (userPreferences.capabilities && userPreferences.capabilities.length > 0) {
			candidates = candidates.filter((m) =>
				userPreferences.capabilities!.every((cap) => m.freeMetadata.capabilities.includes(cap)),
			);
		}

		if (candidates.length === 0) {
			if (!userHasOptedInToPaid && this.requireExplicitPaidOptIn) {
				throw new PaidModelBlockedError({
					message: "No free models match the specified criteria. Pass --paid to allow paid models.",
					availableFreeModels: freeModels.map(displayId),
					availablePaidModels: this.getPaidModels().map(displayId),
				});
			}
			throw new ModelsError("no_matching_free_models", "No models match the specified criteria");
		}

		const selected = this.scoreAndSelect(candidates, userPreferences);
		const fallbacks = this.getFallbacks(selected, candidates);

		return {
			model: selected,
			reasoning: `Selected free-eligible model ${displayId(selected)}`,
			fallbacks,
		};
	}

	private selectFromModels(models: ModexModel[], prefs: UserPreferences, reasoning: string): ModelSelection {
		const selected = this.scoreAndSelect(models, prefs);
		return {
			model: selected,
			reasoning: `${reasoning}: ${displayId(selected)}`,
			fallbacks: this.getFallbacks(selected, models),
		};
	}

	private scoreAndSelect(models: ModexModel[], prefs: UserPreferences): ModexModel {
		let scored = models.map((m) => ({ model: m, score: 0 }));

		if (prefs.modelPattern) {
			const pattern = prefs.modelPattern.toLowerCase();
			scored = scored.map(({ model, score }) => ({
				model,
				score:
					score +
					(model.id.toLowerCase().includes(pattern) || (model.name?.toLowerCase().includes(pattern) ?? false)
						? 10
						: 0),
			}));
		}

		if (prefs.thinkingLevel && prefs.thinkingLevel !== "off") {
			scored = scored.map(({ model, score }) => ({
				model,
				score: score + (model.reasoning ? 5 : 0),
			}));
		}

		scored = scored.map(({ model, score }) => ({
			model,
			score:
				score +
				(model.freeMetadata.quota &&
				model.freeMetadata.quota.remaining !== undefined &&
				model.freeMetadata.quota.remaining > 0
					? 3
					: 0) +
				Math.min(model.contextWindow / 100000, 5),
		}));

		scored.sort((a, b) => b.score - a.score);
		return scored[0].model;
	}

	private getFallbacks(selected: ModexModel, candidates: ModexModel[]): ModexModel[] {
		const others = candidates.filter((m) => `${m.provider}/${m.id}` !== `${selected.provider}/${selected.id}`);
		const crossProvider = others.filter((m) => m.provider !== selected.provider);
		const sameProvider = others.filter((m) => m.provider === selected.provider);
		return [...crossProvider, ...sameProvider].slice(0, this.maxFallbacksPerRequest);
	}

	classifyError(error: Error): string {
		const message = error.message.toLowerCase();

		if (
			message.includes("timeout") ||
			message.includes("econnreset") ||
			message.includes("etimedout") ||
			message.includes("enotfound") ||
			message.includes("fetch failed") ||
			message.includes("network")
		) {
			return "transient";
		}
		if (message.includes("429") || message.includes("rate limit") || message.includes("rate_limit")) {
			return "rate_limit";
		}
		if (message.includes("quota") || message.includes("billing")) {
			return "quota_exceeded";
		}
		if (
			message.includes("413") ||
			message.includes("context length") ||
			message.includes("context overflow") ||
			message.includes("token limit")
		) {
			return "context_overflow";
		}
		if (
			message.includes("401") ||
			message.includes("unauthorized") ||
			message.includes("invalid api key") ||
			message.includes("auth")
		) {
			return "auth_failure";
		}
		if (message.includes("404") || message.includes("model not found")) {
			return "model_not_found";
		}

		return "unknown";
	}

	shouldFallback(error: Error, model: ModexModel): boolean {
		const key = `${model.provider}/${model.id}`;
		const errorCode = this.classifyError(error);
		const attempts = this.fallbackAttempts.get(key)?.get(errorCode) ?? 0;

		if (attempts >= this.maxFallbacksPerRequest) return false;

		return FALLBACK_ERRORS.includes(errorCode);
	}

	recordFallbackAttempt(model: ModexModel, error: Error): void {
		const key = `${model.provider}/${model.id}`;
		const errorCode = this.classifyError(error);
		let modelAttempts = this.fallbackAttempts.get(key);
		if (!modelAttempts) {
			modelAttempts = new Map();
			this.fallbackAttempts.set(key, modelAttempts);
		}
		modelAttempts.set(errorCode, (modelAttempts.get(errorCode) ?? 0) + 1);
	}

	clearFallbackAttempts(model: ModexModel): void {
		this.fallbackAttempts.delete(`${model.provider}/${model.id}`);
	}
}
