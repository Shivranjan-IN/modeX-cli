import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AgentTool } from "../types.js";

export interface GlobToolOptions {
	cwd: string;
	maxResults?: number;
	skipDirs?: string[];
}

const DEFAULT_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".cache"]);

function globToRegex(pattern: string): RegExp {
	let regex = "";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				regex += ".*";
				i++;
				if (pattern[i + 1] === "/") i++;
			} else {
				regex += "[^/]*";
			}
		} else if (ch === "?") {
			regex += "[^/]";
		} else if (ch === "{") {
			const close = pattern.indexOf("}", i);
			if (close === -1) {
				regex += "\\{";
			} else {
				const alternatives = pattern.slice(i + 1, close).split(",");
				regex += `(${alternatives.map((a) => a.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
				i = close;
			}
		} else if (".+^$()|[]\\".includes(ch)) {
			regex += `\\${ch}`;
		} else {
			regex += ch;
		}
	}
	return new RegExp(`^${regex}$`);
}

export function createGlobTool(options: GlobToolOptions): AgentTool {
	const maxResults = options.maxResults ?? 500;
	const skipDirs = new Set([...DEFAULT_SKIP, ...(options.skipDirs ?? [])]);

	function* walk(dir: string, depth: number): Generator<string> {
		if (depth > 20) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;
				yield* walk(full, depth + 1);
			} else if (entry.isFile()) {
				yield full;
			}
		}
	}

	return {
		name: "glob",
		label: "Find files",
		description:
			"Find files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.json'). Supports * (within a path segment), ** (across directories), ? and {a,b} alternatives. Returns matching paths sorted by modification time (newest first).",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Glob pattern to match files against" },
				path: { type: "string", description: "Directory to search from (default: working directory)" },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { pattern: string; path?: string }) {
			const searchRoot = params.path ? resolve(options.cwd, params.path) : options.cwd;
			const regex = globToRegex(params.pattern);

			const matches: { path: string; mtime: number }[] = [];
			let truncated = false;

			for (const file of walk(searchRoot, 0)) {
				if (matches.length >= maxResults) {
					truncated = true;
					break;
				}
				const relPath = relative(searchRoot, file).split("\\").join("/");
				if (regex.test(relPath)) {
					let mtime = 0;
					try {
						mtime = statSync(file).mtimeMs;
					} catch {
						mtime = 0;
					}
					matches.push({ path: relPath, mtime });
				}
			}

			matches.sort((a, b) => b.mtime - a.mtime);

			if (matches.length === 0) {
				return {
					content: [{ type: "text", text: `No files match "${params.pattern}"` }],
					details: { matches: 0 },
					isError: false,
				};
			}

			const lines = matches.map((m) => m.path);
			const header = `${matches.length} file(s)${truncated ? ` (truncated at ${maxResults})` : ""} matching "${params.pattern}":`;
			return {
				content: [{ type: "text", text: `${header}\n${lines.join("\n")}` }],
				details: { matches: matches.length, truncated },
				isError: false,
			};
		},
	};
}
