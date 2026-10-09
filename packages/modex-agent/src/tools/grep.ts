import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentTool } from "../types.js";

export interface GrepToolOptions {
	cwd: string;
	maxFileBytes?: number;
	maxResults?: number;
	skipDirs?: string[];
}

const DEFAULT_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".cache"]);
const NUL = String.fromCharCode(0);

export function createGrepTool(options: GrepToolOptions): AgentTool {
	const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
	const maxResults = options.maxResults ?? 200;
	const skipDirs = new Set([...DEFAULT_SKIP, ...(options.skipDirs ?? [])]);

	function* walk(dir: string): Generator<string> {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;
				yield* walk(join(dir, entry.name));
			} else if (entry.isFile()) {
				yield join(dir, entry.name);
			}
		}
	}

	return {
		name: "grep",
		label: "Search files",
		description:
			"Search file contents recursively with a regular expression. Returns matching lines with file path and line number. Skips node_modules, .git, dist, and hidden directories.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Regular expression to search for" },
				path: { type: "string", description: "Directory or file to search (default: working directory)" },
				case_insensitive: { type: "boolean", description: "Case-insensitive search (default: false)" },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { pattern: string; path?: string; case_insensitive?: boolean }) {
			const searchRoot = params.path
				? isAbsolute(params.path)
					? params.path
					: resolve(options.cwd, params.path)
				: options.cwd;

			let regex: RegExp;
			try {
				regex = new RegExp(params.pattern, params.case_insensitive ? "i" : "");
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
					isError: true,
				};
			}

			const results: string[] = [];
			let filesSearched = 0;
			let truncated = false;

			try {
				const rootStats = statSync(searchRoot);
				const files = rootStats.isFile() ? [searchRoot] : [...walk(searchRoot)];

				for (const file of files) {
					if (results.length >= maxResults) {
						truncated = true;
						break;
					}
					try {
						const stats = statSync(file);
						if (stats.size > maxFileBytes) continue;
					} catch {
						continue;
					}
					let content: string;
					try {
						content = readFileSync(file, "utf8");
					} catch {
						continue;
					}
					if (content.includes(NUL)) continue;
					filesSearched++;
					const lines = content.split("\n");
					for (let i = 0; i < lines.length; i++) {
						if (results.length >= maxResults) {
							truncated = true;
							break;
						}
						if (regex.test(lines[i])) {
							const relPath = relative(options.cwd, file);
							results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
						}
					}
				}
			} catch (error) {
				return {
					content: [
						{ type: "text", text: `Search failed: ${error instanceof Error ? error.message : String(error)}` },
					],
					details: undefined,
					isError: true,
				};
			}

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: `No matches for /${params.pattern}/ in ${filesSearched} files` }],
					details: { matches: 0, filesSearched },
					isError: false,
				};
			}

			const header = `${results.length} match(es)${truncated ? ` (truncated at ${maxResults})` : ""} in ${filesSearched} files:`;
			return {
				content: [{ type: "text", text: `${header}\n${results.join("\n")}` }],
				details: { matches: results.length, filesSearched, truncated },
				isError: false,
			};
		},
	};
}
