import type { Agent, AgentMessage } from "@modex/agent";
import type { AssistantMessage, FreeRouter, ModexModel } from "@modex/ai";

export interface FailedAttempt {
	model: ModexModel;
	errorKind: string;
	errorMessage: string;
}

export interface FallbackRunResult {
	finalModel: ModexModel;
	message?: AssistantMessage;
	failedAttempts: FailedAttempt[];
}

export interface RunWithFallbackOptions {
	agent: Agent;
	router: FreeRouter;
	candidates: ModexModel[];
	userMessage: AgentMessage;
	onFallback?: (from: ModexModel, to: ModexModel, errorKind: string, errorMessage: string) => void;
}

function displayId(model: ModexModel): string {
	return model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
}

/**
 * Runs a prompt, automatically retrying with the next free model when the
 * current one fails (auth, rate limit, dead model, transient network...).
 * On auth_failure only cross-provider fallback is attempted, since the
 * whole provider's key is bad.
 */
export async function runWithFallback(options: RunWithFallbackOptions): Promise<FallbackRunResult> {
	const { agent, router, userMessage, onFallback } = options;
	const candidates = options.candidates.slice();
	const failedAttempts: FailedAttempt[] = [];

	let current = candidates[0];
	if (!current) {
		throw new Error("No model candidates for fallback");
	}

	for (let i = 0; i < candidates.length; i++) {
		current = candidates[i];
		agent.state.model = current;
		const messageCountBefore = agent.state.messages.length;

		await agent.prompt(userMessage);

		const last = agent.state.messages[agent.state.messages.length - 1];
		if (last?.role !== "assistant" || last.stopReason !== "error" || !last.errorMessage) {
			return {
				finalModel: current,
				message: last?.role === "assistant" ? last : undefined,
				failedAttempts,
			};
		}

		const errorMessage = last.errorMessage;
		const error = new Error(errorMessage);
		const errorKind = router.classifyError(error);
		failedAttempts.push({ model: current, errorKind, errorMessage });
		router.recordFallbackAttempt(current, error);

		let next: ModexModel | undefined;
		for (let j = i + 1; j < candidates.length; j++) {
			const candidate = candidates[j];
			if (errorKind === "auth_failure" && candidate.provider === current.provider) continue;
			next = candidate;
			break;
		}

		if (!next || !router.shouldFallback(error, current)) {
			return { finalModel: current, message: last, failedAttempts };
		}

		agent.state.messages = agent.state.messages.slice(0, messageCountBefore);
		onFallback?.(current, next, errorKind, errorMessage);
	}

	return { finalModel: current, failedAttempts };
}

export function fallbackNote(from: ModexModel, to: ModexModel, errorKind: string, errorMessage: string): string {
	const shortError = errorMessage.length > 120 ? `${errorMessage.slice(0, 120)}…` : errorMessage;
	return `${displayId(from)} failed (${errorKind}: ${shortError}) — trying ${displayId(to)}`;
}
