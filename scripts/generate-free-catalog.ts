#!/usr/bin/env node
/**
 * Validates the free-tier model catalog in packages/modex-ai/src/catalog.ts.
 *
 * Invariants checked:
 * - every model has freeMetadata with a valid freeEligibility
 * - free-eligible models have a verifiedAt within the last 30 days
 * - free-eligible models have zero-priced input/output (free means free)
 * - every model has a baseUrl and a known provider endpoint
 * - no duplicate provider/id pairs
 *
 * Run: node scripts/generate-free-catalog.ts
 */
import { getCatalogModels, PROVIDER_ENDPOINTS } from "../packages/modex-ai/dist/index.js";

const MAX_AGE_DAYS = 30;
const now = Date.now();
let failures = 0;

function fail(message: string): void {
	console.error(`✗ ${message}`);
	failures++;
}

function ok(message: string): void {
	console.log(`✓ ${message}`);
}

const models = getCatalogModels();
ok(`Loaded ${models.length} catalog models`);

const seen = new Set<string>();
for (const model of models) {
	const key = `${model.provider}/${model.id}`;
	if (seen.has(key)) fail(`Duplicate model: ${key}`);
	seen.add(key);

	if (!model.baseUrl) fail(`Missing baseUrl: ${key}`);
	if (!model.freeMetadata) {
		fail(`Missing freeMetadata: ${key}`);
		continue;
	}

	const { freeEligibility, verifiedAt } = model.freeMetadata;
	if (!["free", "paid", "unknown", "trial"].includes(freeEligibility)) {
		fail(`Invalid freeEligibility "${freeEligibility}" on ${key}`);
	}

	if (freeEligibility === "free") {
		const age = now - new Date(verifiedAt).getTime();
		if (Number.isNaN(age)) {
			fail(`Invalid verifiedAt on ${key}: ${verifiedAt}`);
		} else if (age > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
			fail(
				`Stale free eligibility (${Math.floor(age / 86400000)} days) on ${key} — refresh verifiedAt or mark as unknown`,
			);
		}
		if (model.cost.input !== 0 || model.cost.output !== 0) {
			fail(`Free model ${key} has non-zero cost (${model.cost.input}/${model.cost.output})`);
		}
	}

	if (!model.contextWindow || !model.maxTokens) {
		fail(`Missing contextWindow/maxTokens on ${key}`);
	}
}

const endpointIds = new Set(PROVIDER_ENDPOINTS.map((e) => e.id));
for (const model of models) {
	if (!endpointIds.has(model.provider)) {
		fail(`Model ${model.provider}/${model.id} has no provider endpoint (env key unknown)`);
	}
}
ok(`Validated ${PROVIDER_ENDPOINTS.length} provider endpoints`);

const freeCount = models.filter((m) => m.freeMetadata.freeEligibility === "free").length;
const paidCount = models.filter((m) => m.freeMetadata.freeEligibility === "paid").length;
ok(`${freeCount} free / ${paidCount} paid models in catalog`);

if (failures > 0) {
	console.error(`\n${failures} validation failure(s)`);
	process.exit(1);
}
console.log("\nCatalog is valid.");
