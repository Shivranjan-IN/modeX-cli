import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@modex/agent";

export type PermissionRule = "allow" | "deny";

export interface ModexSettings {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	paid?: boolean;
	permissions?: Record<string, PermissionRule>;
	systemPrompt?: string;
}

export function configDir(): string {
	return process.env.MODEX_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".modex");
}

export function settingsPath(): string {
	return join(configDir(), "config.json");
}

export function sessionsDir(): string {
	return join(configDir(), "sessions");
}

export function loadSettings(): ModexSettings {
	const path = settingsPath();
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ModexSettings;
	} catch {
		return {};
	}
}

export function saveSettings(settings: ModexSettings): void {
	const path = settingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(settings, null, "\t"), "utf8");
}

export function updateSettings(patch: Partial<ModexSettings>): ModexSettings {
	const current = loadSettings();
	const next = { ...current, ...patch };
	saveSettings(next);
	return next;
}
