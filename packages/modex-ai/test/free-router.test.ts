import { describe, expect, it } from "vitest";
import { PaidModelBlockedError } from "../src/errors.js";
import { FreeRouter } from "../src/free-router.js";
import type { Models, ModexModel } from "../src/types.js";

function makeModel(overrides: Partial<ModexModel> & { id: string; provider?: string }): ModexModel {
	return {
		api: "openai-completions",
		provider: overrides.provider ?? "groq",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		freeMetadata: {
			freeEligibility: "free",
			verifiedAt: new Date().toISOString(),
			verificationSource: "catalog",
			capabilities: ["tool-calling"],
		},
		...overrides,
	} as ModexModel;
}

function makeModels(models: ModexModel[]): Models {
	return {
		getProviders: () => [],
		getProvider: () => undefined,
		getModels: () => models,
		getModel: () => undefined,
		getAllModels: () => models,
		stream: () => {
			throw new Error("not needed");
		},
		complete: () => {
			throw new Error("not needed");
		},
	};
}

const freeGroq = makeModel({ id: "llama-3.3-70b-versatile", provider: "groq" });
const freeCerebras = makeModel({ id: "llama-3.3-70b", provider: "cerebras" });
const paidOpenAI = makeModel({
	id: "gpt-5",
	provider: "openai",
	freeMetadata: {
		freeEligibility: "paid",
		verifiedAt: new Date().toISOString(),
		verificationSource: "docs",
		capabilities: ["tool-calling"],
	},
});
const unknownModel = makeModel({
	id: "mystery-model",
	provider: "custom",
	freeMetadata: {
		freeEligibility: "unknown",
		verifiedAt: new Date().toISOString(),
		verificationSource: "manual",
		capabilities: [],
	},
});

describe("FreeRouter", () => {
	it("selects a free model when free models exist", async () => {
		const router = new FreeRouter({ models: makeModels([freeGroq, freeCerebras, paidOpenAI]) });
		const selection = await router.selectModel({}, false);
		expect(selection.model.freeMetadata.freeEligibility).toBe("free");
		expect(selection.reasoning).toContain("free");
	});

	it("never selects unknown-eligibility models", () => {
		const router = new FreeRouter({ models: makeModels([unknownModel, paidOpenAI]) });
		expect(router.getFreeEligibleModels()).toHaveLength(0);
		expect(router.isFreeEligible(unknownModel)).toBe(false);
	});

	it("throws PaidModelBlockedError when no free models and no opt-in", async () => {
		const router = new FreeRouter({ models: makeModels([paidOpenAI]) });
		await expect(router.selectModel({}, false)).rejects.toThrow(PaidModelBlockedError);
	});

	it("allows paid models with explicit opt-in", async () => {
		const router = new FreeRouter({ models: makeModels([paidOpenAI]) });
		const selection = await router.selectModel({}, true);
		expect(selection.model.id).toBe("gpt-5");
	});

	it("respects provider preference among free models", async () => {
		const router = new FreeRouter({ models: makeModels([freeGroq, freeCerebras]) });
		const selection = await router.selectModel({ provider: "cerebras" }, false);
		expect(selection.model.provider).toBe("cerebras");
	});

	it("respects model pattern among free models", async () => {
		const router = new FreeRouter({ models: makeModels([freeGroq, freeCerebras]) });
		const selection = await router.selectModel({ modelPattern: "llama-3.3-70b" }, false);
		expect(["groq", "cerebras"]).toContain(selection.model.provider);
	});

	it("throws PaidModelBlockedError for unmatched pattern without opt-in", async () => {
		const router = new FreeRouter({ models: makeModels([freeGroq]) });
		await expect(router.selectModel({ modelPattern: "nonexistent" }, false)).rejects.toThrow(PaidModelBlockedError);
	});

	it("rejects stale free eligibility", () => {
		const stale = makeModel({
			id: "stale",
			freeMetadata: {
				freeEligibility: "free",
				verifiedAt: "2020-01-01T00:00:00Z",
				verificationSource: "catalog",
				capabilities: [],
			},
		});
		const router = new FreeRouter({ models: makeModels([stale]) });
		expect(router.isFreeEligible(stale)).toBe(false);
	});

	it("classifies errors and limits fallbacks", () => {
		const router = new FreeRouter({ models: makeModels([freeGroq, freeCerebras]), maxFallbacksPerRequest: 2 });
		expect(router.classifyError(new Error("429 rate limit exceeded"))).toBe("rate_limit");
		expect(router.classifyError(new Error("ECONNRESET"))).toBe("transient");
		expect(router.classifyError(new Error("invalid api key"))).toBe("auth_failure");
		expect(router.classifyError(new Error("HTTP 404: Function not found"))).toBe("model_not_found");

		const err = new Error("429 rate limit");
		expect(router.shouldFallback(err, freeGroq)).toBe(true);
		router.recordFallbackAttempt(freeGroq, err);
		router.recordFallbackAttempt(freeGroq, err);
		expect(router.shouldFallback(err, freeGroq)).toBe(false);
	});

	it("falls back on auth failures and dead models", () => {
		const router = new FreeRouter({ models: makeModels([freeGroq, freeCerebras]) });
		expect(router.shouldFallback(new Error("HTTP 401: User not found"), freeGroq)).toBe(true);
		expect(router.shouldFallback(new Error("HTTP 404: model not found"), freeGroq)).toBe(true);
	});

	it("orders fallbacks cross-provider first", async () => {
		const groq2 = makeModel({ id: "llama-3.1-8b", provider: "groq" });
		const router = new FreeRouter({
			models: makeModels([freeGroq, groq2, freeCerebras]),
			maxFallbacksPerRequest: 10,
		});
		const selection = await router.selectModel({}, false);
		expect(selection.model.provider).toBe("groq");
		expect(selection.fallbacks[0].provider).toBe("cerebras");
		expect(selection.fallbacks[1].provider).toBe("groq");
	});
});
