import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentTool } from "../types.js";

export interface LsToolOptions {
	cwd: string;
}

export function createLsTool(options: LsToolOptions): AgentTool {
	return {
		name: "ls",
		label: "List directory",
		description:
			"List files and directories at a given path. Directories are marked with a trailing slash. Returns name, type, and size for each entry.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Directory to list (default: working directory)" },
			},
			required: [],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { path?: string }) {
			const dirPath = params?.path
				? isAbsolute(params.path)
					? params.path
					: resolve(options.cwd, params.path)
				: options.cwd;
			try {
				const stats = statSync(dirPath);
				if (!stats.isDirectory()) {
					return {
						content: [{ type: "text", text: `${dirPath} is a file, not a directory` }],
						details: undefined,
						isError: true,
					};
				}
				const entries = readdirSync(dirPath, { withFileTypes: true });
				if (entries.length === 0) {
					return {
						content: [{ type: "text", text: `${dirPath} is empty` }],
						details: { path: dirPath, entries: [] },
						isError: false,
					};
				}
				const lines = entries
					.sort((a, b) => {
						if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
						return a.name.localeCompare(b.name);
					})
					.map((entry) => {
						const full = join(dirPath, entry.name);
						let size = 0;
						try {
							size = statSync(full).size;
						} catch {
							size = 0;
						}
						const type = entry.isDirectory() ? "dir " : entry.isSymbolicLink() ? "link" : "file";
						const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
						return `${type} ${String(size).padStart(10)}  ${name}`;
					});
				const displayPath = relative(options.cwd, dirPath) || ".";
				return {
					content: [{ type: "text", text: `${displayPath}/\n${lines.join("\n")}` }],
					details: { path: dirPath, count: entries.length },
					isError: false,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to list ${dirPath}: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
					isError: true,
				};
			}
		},
	};
}
