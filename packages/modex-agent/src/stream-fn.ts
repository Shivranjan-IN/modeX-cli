import type { ApiStreamOptions, AssistantMessageEventStream, Model, TranscriptContext } from "@modex/ai";
import type { StreamFn } from "./types.js";

export function createStreamFn(
	stream: (model: Model, context: TranscriptContext, options?: ApiStreamOptions) => AssistantMessageEventStream,
): StreamFn {
	return stream;
}

export function getDefaultStreamFn(): StreamFn {
	return () => {
		throw new Error("No stream function configured. Provide a streamFn in AgentOptions.");
	};
}
