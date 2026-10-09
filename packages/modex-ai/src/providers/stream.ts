import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "../types.js";

export function createAssistantMessageStream(): AssistantMessageEventStream & {
	push(event: AssistantMessageEvent): void;
	end(message: AssistantMessage): void;
	fail(message: AssistantMessage): void;
} {
	const queue: AssistantMessageEvent[] = [];
	let done = false;
	let error: unknown;
	let resolveResult: ((message: AssistantMessage) => void) | undefined;
	const resultPromise = new Promise<AssistantMessage>((resolve) => {
		resolveResult = resolve;
	});
	let notify: (() => void) | undefined;

	const wake = () => {
		notify?.();
		notify = undefined;
	};

	const iterator: AsyncIterator<AssistantMessageEvent> = {
		async next(): Promise<IteratorResult<AssistantMessageEvent>> {
			while (true) {
				if (queue.length > 0) {
					return { value: queue.shift()!, done: false };
				}
				if (error) throw error;
				if (done) return { value: undefined as any, done: true };
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
			}
		},
	};

	return {
		[Symbol.asyncIterator]() {
			return iterator;
		},
		push(event: AssistantMessageEvent): void {
			if (done) return;
			queue.push(event);
			wake();
		},
		end(message: AssistantMessage): void {
			if (done) return;
			done = true;
			queue.push({ type: "done", message });
			wake();
			resolveResult?.(message);
		},
		fail(message: AssistantMessage): void {
			if (done) return;
			done = true;
			queue.push({ type: "error", message });
			wake();
			resolveResult?.(message);
		},
		result(): Promise<AssistantMessage> {
			return resultPromise;
		},
	};
}
