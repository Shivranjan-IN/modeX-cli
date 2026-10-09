import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "./types.js";

export function defaultCredentialsPath(): string {
	const home = process.env.MODEX_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".modex");
	return join(home, "credentials.json");
}

interface CredentialsFile {
	[providerId: string]: Credential;
}

export class FileCredentialStore implements CredentialStore {
	private readonly filePath: string;

	constructor(filePath: string = defaultCredentialsPath()) {
		this.filePath = filePath;
	}

	private readAll(): CredentialsFile {
		if (!existsSync(this.filePath)) return {};
		try {
			return JSON.parse(readFileSync(this.filePath, "utf8"));
		} catch {
			return {};
		}
	}

	private writeAll(data: CredentialsFile): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(this.filePath, JSON.stringify(data, null, "\t"), { mode: 0o600 });
		try {
			chmodSync(this.filePath, 0o600);
		} catch {
			// chmod is best-effort (not supported on all Windows setups)
		}
	}

	async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
		return this.readAll()[providerId];
	}

	async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const data = this.readAll();
		return Object.entries(data).map(([providerId, cred]) => ({ providerId, type: cred.type }));
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const data = this.readAll();
		const next = await fn(data[providerId]);
		if (next === undefined) {
			delete data[providerId];
		} else {
			data[providerId] = next;
		}
		this.writeAll(data);
		return next;
	}

	async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
		const data = this.readAll();
		delete data[providerId];
		this.writeAll(data);
	}
}
