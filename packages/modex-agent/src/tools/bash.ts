import { spawn } from "node:child_process";
import type { AgentTool } from "../types.js";

export interface BashToolOptions {
	cwd: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
}

export function createBashTool(options: BashToolOptions): AgentTool {
	const timeoutMs = options.timeoutMs ?? 120_000;
	const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
	return {
		name: "bash",
		label: "Run command",
		description:
			"Execute a shell command in the working directory and return its output. The command times out after 2 minutes. Use for git, npm, file exploration, builds, etc.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string", description: "The shell command to execute" },
				timeout_ms: {
					type: "number",
					description: `Optional timeout in milliseconds (default ${timeoutMs}, max 600000)`,
				},
			},
			required: ["command"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { command: string; timeout_ms?: number }, signal?: AbortSignal) {
			const effectiveTimeout = Math.min(params.timeout_ms ?? timeoutMs, 600_000);
			return new Promise<{ content: { type: "text"; text: string }[]; details: unknown; isError?: boolean }>(
				(resolvePromise) => {
					let stdout = "";
					let stderr = "";
					let settled = false;

					const child = spawn(params.command, {
						shell: true,
						cwd: options.cwd,
						env: { ...process.env },
						windowsHide: true,
					});

					const finish = (isError: boolean, extra?: string) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						const parts: string[] = [];
						if (stdout) parts.push(stdout);
						if (stderr) parts.push(stderr.startsWith("stderr:") ? stderr : `stderr:\n${stderr}`);
						if (extra) parts.push(extra);
						const text = parts.join("\n").slice(0, maxOutputBytes) || "(no output)";
						resolvePromise({
							content: [{ type: "text", text }],
							details: { command: params.command, exitCode: child.exitCode },
							isError,
						});
					};

					const timer = setTimeout(() => {
						child.kill();
						finish(true, `Command timed out after ${effectiveTimeout}ms and was killed`);
					}, effectiveTimeout);

					const onAbort = () => {
						child.kill();
						finish(true, "Command aborted");
					};
					signal?.addEventListener("abort", onAbort, { once: true });

					child.stdout.on("data", (data: Buffer) => {
						stdout += data.toString();
					});
					child.stderr.on("data", (data: Buffer) => {
						stderr += data.toString();
					});
					child.on("error", (error) => {
						signal?.removeEventListener("abort", onAbort);
						finish(true, `Failed to start command: ${error.message}`);
					});
					child.on("close", (code) => {
						signal?.removeEventListener("abort", onAbort);
						finish(code !== 0 && code !== null, code !== null && code !== 0 ? `exit code: ${code}` : undefined);
					});
				},
			);
		},
	};
}
