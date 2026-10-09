import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { updateSettings, type ModexSettings } from "./settings.js";
import chalk from "chalk";
import { orange } from "./colors.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface PermissionRequest {
	toolName: string;
	summary: string;
	details?: Record<string, unknown>;
}

export type PermissionDecision = "allow" | "deny" | "always" | "never";

export type PermissionChecker = (request: PermissionRequest) => Promise<"allow" | "deny">;

export interface GranularPermissionRule {
	tool: string;
	action?: "create" | "edit" | "delete" | "execute" | "read" | "list" | "unknown";
	path?: string;
	pattern?: string;
	decision: "allow" | "deny";
	priority: number;
}

export type LegacyPermissionRule = "allow" | "deny";

export type PermissionRule = LegacyPermissionRule | GranularPermissionRule;

export interface EnhancedPermissions {
	rules: PermissionRule[];
}

function loadSettings(): ModexSettings {
	const path = join(configDir(), "config.json");
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ModexSettings;
	} catch {
		return {};
	}
}

function saveSettings(settings: ModexSettings): void {
	const path = join(configDir(), "config.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(settings, null, "\t"), "utf8");
}

function configDir(): string {
	return process.env.MODEX_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".modex");
}

function loadEnhancedPermissions(): EnhancedPermissions {
	const settings = loadSettings();
	const perms = settings.permissions as unknown;
	if (!perms) return { rules: [] };

	if (Array.isArray(perms)) {
		return { rules: perms as PermissionRule[] };
	}

	const rules: PermissionRule[] = [];
	for (const [key, value] of Object.entries(perms as Record<string, unknown>)) {
		if (typeof value === "string") {
			rules.push({ tool: key, action: undefined, path: undefined, pattern: undefined, decision: value as "allow" | "deny", priority: 10 });
		} else if (typeof value === "object" && value !== null) {
			rules.push(value as GranularPermissionRule);
		}
	}
	return { rules };
}

function saveEnhancedPermissions(perms: EnhancedPermissions): void {
	const settings = loadSettings();
	settings.permissions = perms.rules as unknown as Record<string, LegacyPermissionRule>;
	saveSettings(settings);
}

function matchGlob(pattern: string, target: string): boolean {
	const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
	return regex.test(target);
}

function getActionFromTool(toolName: string, params: Record<string, unknown>): GranularPermissionRule["action"] {
	switch (toolName) {
		case "bash":
			return "execute";
		case "read":
			return "read";
		case "write":
			return "create";
		case "edit":
			return "edit";
		case "ls":
			return "list";
		case "grep":
			return "read";
		case "glob":
			return "list";
		default:
			return "unknown";
	}
}

function getPathFromParams(toolName: string, params: Record<string, unknown>): string | undefined {
	switch (toolName) {
		case "bash":
			return params.cwd as string;
		case "read":
		case "write":
		case "edit":
			return params.path as string;
		case "ls":
		case "grep":
		case "glob":
			return params.path as string;
		default:
			return undefined;
	}
}

export function createPermissionChecker(_existing?: Record<string, LegacyPermissionRule>): PermissionChecker {
	const perms = loadEnhancedPermissions();
	let rules = perms.rules.length > 0 ? [...perms.rules] : [];

	return async (request) => {
		const action = getActionFromTool(request.toolName, request.details || {});
		const path = getPathFromParams(request.toolName, request.details || {});

		for (const rule of rules) {
			if (typeof rule === "string") {
				if (rule === "allow") return "allow";
				if (rule === "deny") return "deny";
				continue;
			}

			if (rule.tool !== request.toolName) continue;
			if (rule.action && rule.action !== action) continue;
			if (rule.path && path && !path.startsWith(rule.path)) continue;
			if (rule.pattern && path && !matchGlob(rule.pattern, path)) continue;

			return rule.decision;
		}

		const rl = createInterface({ input: stdin, output: stdout });
		try {
			stdout.write(`\n${orange("Permission Request")}\n`);
			stdout.write(`  Tool: ${chalk.cyan(request.toolName)} (${action})\n`);
			if (path) stdout.write(`  Path: ${chalk.dim(path)}\n`);
			stdout.write(`  Summary: ${request.summary}\n`);
			stdout.write(`  ${orange("[y]es / [n]o / [a]lways / [d]eny-always / [p]ath-only / [g]lob: ")}`);
			const answer = (await rl.question("")).trim().toLowerCase();

			switch (answer) {
				case "y":
				case "yes":
					return "allow";
				case "a":
				case "always":
					rules.push({ tool: request.toolName, action: undefined, path: undefined, pattern: undefined, decision: "allow", priority: 10 });
					saveEnhancedPermissions({ rules });
					return "allow";
				case "p":
				case "path-only":
					if (path) {
						rules.push({ tool: request.toolName, action, path, pattern: undefined, decision: "allow", priority: 20 });
						saveEnhancedPermissions({ rules });
					}
					return "allow";
				case "g":
				case "glob":
					if (path) {
						const globInput = await rl.question("  Enter glob pattern (e.g. src/**/*.ts): ");
						if (globInput.trim()) {
							rules.push({ tool: request.toolName, action, path: undefined, pattern: globInput.trim(), decision: "allow", priority: 20 });
							saveEnhancedPermissions({ rules });
						}
					}
					return "allow";
				case "d":
				case "deny-always":
					rules.push({ tool: request.toolName, action: undefined, path: undefined, pattern: undefined, decision: "deny", priority: 10 });
					saveEnhancedPermissions({ rules });
					return "deny";
				default:
					return "deny";
			}
		} finally {
			rl.close();
		}
	};
}

export function listPermissionRules(): GranularPermissionRule[] {
	const perms = loadEnhancedPermissions();
	return perms.rules.filter((r): r is GranularPermissionRule => typeof r === "object" && "tool" in r);
}

export function addPermissionRule(rule: GranularPermissionRule): void {
	const perms = loadEnhancedPermissions();
	perms.rules.push({ ...rule, priority: rule.priority ?? 10 });
	perms.rules.sort((a, b) => {
		const pa = typeof a === "object" && "priority" in a ? a.priority : 0;
		const pb = typeof b === "object" && "priority" in b ? b.priority : 0;
		return pb - pa;
	});
	saveEnhancedPermissions(perms);
}

export function removePermissionRule(index: number): void {
	const perms = loadEnhancedPermissions();
	const granular = perms.rules.filter((r): r is GranularPermissionRule => typeof r === "object" && "tool" in r);
	if (index >= 0 && index < granular.length) {
		const toRemove = granular[index];
		perms.rules = perms.rules.filter((r) => r !== toRemove);
		saveEnhancedPermissions(perms);
	}
}

export function clearPermissionRules(): void {
	const settings = loadSettings();
	settings.permissions = {};
	saveSettings(settings);
}