import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "../types.js";

export interface EditToolOptions {
	cwd: string;
}

export function createEditTool(options: EditToolOptions): AgentTool {
	return {
		name: "edit",
		label: "Edit file",
		description:
			"Replace an exact string in a file with a new string. The old_string must match exactly once in the file (including whitespace). Read the file first to get the exact text.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file (absolute or relative to the working directory)" },
				old_string: { type: "string", description: "Exact string to replace (must appear exactly once)" },
				new_string: { type: "string", description: "Replacement string" },
			},
			required: ["path", "old_string", "new_string"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { path: string; old_string: string; new_string: string }) {
			const filePath = isAbsolute(params.path) ? params.path : resolve(options.cwd, params.path);
			try {
				if (!existsSync(filePath)) {
					return {
						content: [{ type: "text", text: `File not found: ${filePath}` }],
						details: undefined,
						isError: true,
					};
				}
				const raw = readFileSync(filePath, "utf8");
				const occurrences = raw.split(params.old_string).length - 1;
				if (occurrences === 0) {
					return {
						content: [
							{
								type: "text",
								text: `old_string not found in ${filePath}. Read the file and retry with the exact text.`,
							},
						],
						details: { occurrences: 0 },
						isError: true,
					};
				}
				if (occurrences > 1) {
					return {
						content: [
							{
								type: "text",
								text: `old_string appears ${occurrences} times in ${filePath}. Provide more surrounding context to make it unique.`,
							},
						],
						details: { occurrences },
						isError: true,
					};
				}
				const updated = raw.replace(params.old_string, params.new_string);
				writeFileSync(filePath, updated, "utf8");
				return {
					content: [{ type: "text", text: `Edited ${filePath} (replaced 1 occurrence)` }],
					details: { path: filePath, occurrences },
					isError: false,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to edit ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
					isError: true,
				};
			}
		},
	};
}
