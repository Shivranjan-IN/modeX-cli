export type ModelsErrorCode =
	| "no_models"
	| "no_matching_free_models"
	| "provider_error"
	| "auth_error"
	| "rate_limit"
	| "quota_exceeded"
	| "context_overflow"
	| "model_not_found"
	| "network_error"
	| "unknown";

export class ModelsError extends Error {
	readonly code: ModelsErrorCode;

	constructor(code: ModelsErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ModelsError";
		this.code = code;
	}
}

export interface PaidModelBlockedErrorInfo {
	message: string;
	availableFreeModels: string[];
	availablePaidModels: string[];
}

export class PaidModelBlockedError extends Error {
	readonly info: PaidModelBlockedErrorInfo;

	constructor(info: PaidModelBlockedErrorInfo) {
		super(info.message);
		this.name = "PaidModelBlockedError";
		this.info = info;
	}
}
