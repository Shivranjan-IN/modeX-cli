import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./settings.js";

/**
 * Loads KEY=VALUE pairs from ~/.modex/.env (global) and ./.env (project).
 * Real environment variables always win over file values.
 * Lines starting with # are comments. Values may be optionally quoted.
 */
export function loadDotEnv(): string[] {
	const loaded: string[] = [];
	const candidates = [join(configDir(), ".env"), join(process.cwd(), ".env")];

	for (const filePath of candidates) {
		if (!existsSync(filePath)) continue;
		let content: string;
		try {
			content = readFileSync(filePath, "utf8");
		} catch {
			continue;
		}
		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
				(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
			) {
				value = value.slice(1, -1);
			}
			if (key && !(key in process.env)) {
				process.env[key] = value;
			}
		}
		loaded.push(filePath);
	}
	return loaded;
}
