import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentTool } from "../types.js";

export interface WriteToolOptions {
	cwd: string;
}

export function createWriteTool(options: WriteToolOptions): AgentTool {
	return {
		name: "write",
		label: "Write file",
		description:
			"Write content to a file, creating parent directories as needed. Overwrites the entire file if it exists. Use the edit tool for partial changes.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file (absolute or relative to the working directory)" },
				content: { type: "string", description: "Full content to write to the file" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { path: string; content: string }) {
			const filePath = isAbsolute(params.path) ? params.path : resolve(options.cwd, params.path);
			try {
				const existed = existsSync(filePath);
				mkdirSync(dirname(filePath), { recursive: true });
				writeFileSync(filePath, params.content, "utf8");
				const bytes = Buffer.byteLength(params.content, "utf8");
				return {
					content: [{ type: "text", text: `${existed ? "Overwrote" : "Created"} ${filePath} (${bytes} bytes)` }],
					details: { path: filePath, bytes, existed },
					isError: false,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
					isError: true,
				};
			}
		},
	};
}
