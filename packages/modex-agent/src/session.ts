import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "./types.js";

export interface SessionMeta {
	id: string;
	createdAt: number;
	updatedAt: number;
	title?: string;
	messageCount: number;
	filePath: string;
}

interface SessionFile {
	meta: Omit<SessionMeta, "filePath">;
	messages: AgentMessage[];
}

export function createSessionId(): string {
	const now = Date.now();
	const rand = Math.random().toString(36).slice(2, 8);
	return `sess_${now.toString(36)}_${rand}`;
}

export function sessionFilePath(sessionsDir: string, id: string): string {
	return join(sessionsDir, `${id}.json`);
}

export function saveSession(sessionsDir: string, id: string, messages: AgentMessage[], title?: string): SessionMeta {
	mkdirSync(sessionsDir, { recursive: true });
	const filePath = sessionFilePath(sessionsDir, id);
	let createdAt = Date.now();
	if (existsSync(filePath)) {
		try {
			const existing = JSON.parse(readFileSync(filePath, "utf8")) as SessionFile;
			createdAt = existing.meta.createdAt;
		} catch {
			// corrupted file; overwrite
		}
	}
	const meta: Omit<SessionMeta, "filePath"> = {
		id,
		createdAt,
		updatedAt: Date.now(),
		title: title ?? deriveTitle(messages),
		messageCount: messages.length,
	};
	const data: SessionFile = { meta, messages };
	writeFileSync(filePath, JSON.stringify(data, null, "\t"), "utf8");
	return { ...meta, filePath };
}

export function loadSession(
	sessionsDir: string,
	id: string,
): { meta: SessionMeta; messages: AgentMessage[] } | undefined {
	const filePath = sessionFilePath(sessionsDir, id);
	if (!existsSync(filePath)) return undefined;
	try {
		const data = JSON.parse(readFileSync(filePath, "utf8")) as SessionFile;
		return { meta: { ...data.meta, filePath }, messages: data.messages ?? [] };
	} catch {
		return undefined;
	}
}

export function listSessions(sessionsDir: string): SessionMeta[] {
	if (!existsSync(sessionsDir)) return [];
	const entries: SessionMeta[] = [];
	for (const file of readdirSync(sessionsDir)) {
		if (!file.endsWith(".json")) continue;
		const id = file.slice(0, -".json".length);
		const loaded = loadSession(sessionsDir, id);
		if (loaded) entries.push(loaded.meta);
	}
	entries.sort((a, b) => b.updatedAt - a.updatedAt);
	return entries;
}

export function deleteSession(sessionsDir: string, id: string): boolean {
	const filePath = sessionFilePath(sessionsDir, id);
	if (!existsSync(filePath)) return false;
	try {
		rmSync(filePath);
		return true;
	} catch {
		return false;
	}
}

function deriveTitle(messages: AgentMessage[]): string | undefined {
	const firstUser = messages.find((m) => m.role === "user");
	if (!firstUser || firstUser.role !== "user") return undefined;
	const text = firstUser.content.find((c) => c.type === "text");
	if (!text || text.type !== "text") return undefined;
	return text.text.length > 60 ? `${text.text.slice(0, 57)}...` : text.text;
}
