import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "../types.js";

export interface ReadToolOptions {
	cwd: string;
	maxBytes?: number;
}

export function createReadTool(options: ReadToolOptions): AgentTool {
	const maxBytes = options.maxBytes ?? 256 * 1024;
	return {
		name: "read",
		label: "Read file",
		description:
			"Read a file from the filesystem. Returns content with 1-based line numbers. Supports optional offset and limit to read a portion of large files.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file (absolute or relative to the working directory)" },
				offset: { type: "number", description: "1-based line number to start reading from (default: 1)" },
				limit: { type: "number", description: "Maximum number of lines to read (default: 2000)" },
			},
			required: ["path"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { path: string; offset?: number; limit?: number }) {
			const filePath = isAbsolute(params.path) ? params.path : resolve(options.cwd, params.path);
			try {
				const stats = statSync(filePath);
				if (stats.isDirectory()) {
					return {
						content: [{ type: "text", text: `${filePath} is a directory, use ls to list it` }],
						details: { error: "is_directory" },
						isError: true,
					};
				}
				if (stats.size > maxBytes) {
					return {
						content: [
							{
								type: "text",
								text: `File too large (${stats.size} bytes, limit ${maxBytes}). Use offset/limit or a smaller file.`,
							},
						],
						details: { error: "too_large", size: stats.size },
						isError: true,
					};
				}
				const raw = readFileSync(filePath, "utf8");
				const lines = raw.split("\n");
				const offset = Math.max(1, params.offset ?? 1);
				const limit = Math.min(params.limit ?? 2000, 10000);
				const slice = lines.slice(offset - 1, offset - 1 + limit);
				const numbered = slice.map((line, i) => `${String(offset + i).padStart(6)}→${line}`).join("\n");
				const header = `${filePath} (lines ${offset}-${offset + slice.length - 1} of ${lines.length})`;
				return {
					content: [{ type: "text", text: `${header}\n${numbered}` }],
					details: { path: filePath, totalLines: lines.length, shown: slice.length },
					isError: false,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
					isError: true,
				};
			}
		},
	};
}
