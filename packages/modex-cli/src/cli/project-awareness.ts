import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import chalk from "chalk";

export interface GitStatus {
	branch: string;
	ahead: number;
	behind: number;
	staged: number;
	unstaged: number;
	untracked: number;
	isClean: boolean;
	root: string;
}

export interface ProjectScripts {
	[name: string]: string;
}

export interface ProjectInfo {
	name: string;
	root: string;
	git?: GitStatus;
	scripts: ProjectScripts;
	packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
	hasTypeScript: boolean;
	hasTests: boolean;
	testCommand?: string;
	buildCommand?: string;
}

let cachedProjectInfo: ProjectInfo | null = null;
let cachedGitStatus: GitStatus | null = null;
let lastGitCheck = 0;
const GIT_CACHE_MS = 5000;

function runGit(args: string[], cwd: string): string {
	try {
		return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

function getGitStatus(cwd: string): GitStatus | undefined {
	const now = Date.now();
	if (cachedGitStatus && now - lastGitCheck < GIT_CACHE_MS) {
		return cachedGitStatus;
	}

	const branch = runGit(["branch", "--show-current"], cwd);
	if (!branch) return undefined;

	const status = runGit(["status", "--porcelain=v1"], cwd);
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of status.split("\n").filter(Boolean)) {
		const code = line.slice(0, 2);
		if (code[0] !== " " && code[0] !== "?") staged++;
		if (code[1] !== " ") unstaged++;
		if (code === "??") untracked++;
	}

	const aheadBehind = runGit(["rev-list", "--left-right", "--count", "@{u}...HEAD"], cwd).split("\t");
	const ahead = parseInt(aheadBehind[0] || "0", 10);
	const behind = parseInt(aheadBehind[1] || "0", 10);

	const root = runGit(["rev-parse", "--show-toplevel"], cwd);

	cachedGitStatus = {
		branch,
		ahead,
		behind,
		staged,
		unstaged,
		untracked,
		isClean: staged === 0 && unstaged === 0 && untracked === 0,
		root,
	};
	lastGitCheck = now;
	return cachedGitStatus;
}

function getPackageManager(root: string): "npm" | "yarn" | "pnpm" | "bun" | "unknown" {
	if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
	if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(root, "yarn.lock"))) return "yarn";
	if (existsSync(join(root, "package-lock.json"))) return "npm";
	return "unknown";
}

function getScripts(root: string): ProjectScripts {
	const pkgPath = join(root, "package.json");
	if (!existsSync(pkgPath)) return {};
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		return pkg.scripts || {};
	} catch {
		return {};
	}
}

function findProjectRoot(start: string): string {
	let current = resolve(start);
	while (current !== resolve(current, "..")) {
		if (existsSync(join(current, "package.json")) || existsSync(join(current, ".git"))) {
			return current;
		}
		current = resolve(current, "..");
	}
	return resolve(start);
}

function getProjectName(root: string): string {
	const pkgPath = join(root, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			return pkg.name || root.split(/[/\\]/).pop() || "project";
		} catch {
			return root.split(/[/\\]/).pop() || "project";
		}
	}
	return root.split(/[/\\]/).pop() || "project";
}

export function getProjectInfo(cwd: string = process.cwd()): ProjectInfo {
	if (cachedProjectInfo) return cachedProjectInfo;

	const root = findProjectRoot(cwd);
	const name = getProjectName(root);
	const scripts = getScripts(root);
	const packageManager = getPackageManager(root);
	const git = getGitStatus(root);
	const hasTypeScript = existsSync(join(root, "tsconfig.json"));

	const testCommand = scripts.test || scripts["test:unit"] || scripts["test:run"];
	const buildCommand = scripts.build || scripts.compile;

	cachedProjectInfo = {
		name,
		root,
		git,
		scripts,
		packageManager,
		hasTypeScript,
		hasTests: !!testCommand,
		testCommand,
		buildCommand,
	};
	return cachedProjectInfo;
}

export function invalidateProjectCache(): void {
	cachedProjectInfo = null;
	cachedGitStatus = null;
	lastGitCheck = 0;
}

export function getRelativePath(cwd: string, absolutePath: string): string {
	const rel = relative(cwd, absolutePath);
	return rel.startsWith("..") ? absolutePath : rel;
}

export function listProjectFiles(root: string, options: { maxDepth?: number; ignore?: string[] } = {}): string[] {
	const { maxDepth = 3, ignore = ["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo"] } = options;
	const results: string[] = [];

	function walk(dir: string, depth: number): void {
		if (depth > maxDepth) return;
		const base = dir.split(/[/\\]/).pop() || "";
		if (ignore.includes(base)) return;

		try {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				const st = statSync(full);
				if (st.isDirectory()) {
					walk(full, depth + 1);
				} else {
					results.push(relative(root, full));
				}
			}
		} catch {}
	}

	walk(root, 0);
	return results.sort();
}

export function findFiles(root: string, pattern: string, options: { maxResults?: number } = {}): string[] {
	const { maxResults = 50 } = options;
	const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."), "i");
	const files = listProjectFiles(root);
	return files.filter((f) => regex.test(f)).slice(0, maxResults);
}

export function formatGitStatus(git: GitStatus): string {
	const parts = [];
	parts.push(chalk.magenta(`⎇ ${git.branch}`));
	if (git.ahead > 0) parts.push(chalk.green(`↑${git.ahead}`));
	if (git.behind > 0) parts.push(chalk.red(`↓${git.behind}`));
	if (git.staged > 0) parts.push(chalk.yellow(`+${git.staged}`));
	if (git.unstaged > 0) parts.push(chalk.red(`~${git.unstaged}`));
	if (git.untracked > 0) parts.push(chalk.cyan(`?${git.untracked}`));
	if (git.isClean) parts.push(chalk.green("✓ clean"));
	return parts.join(" ");
}

export function formatScripts(scripts: ProjectScripts): string {
	const entries = Object.entries(scripts);
	if (entries.length === 0) return chalk.dim("No scripts defined");
	const common = ["dev", "build", "test", "lint", "typecheck", "start", "preview"];
	const sorted = entries.sort(([a], [b]) => {
		const ai = common.indexOf(a);
		const bi = common.indexOf(b);
		if (ai !== -1 && bi !== -1) return ai - bi;
		if (ai !== -1) return -1;
		if (bi !== -1) return 1;
		return a.localeCompare(b);
	});
	return sorted.map(([name, cmd]) => `  ${chalk.cyan(name)}: ${chalk.dim(cmd)}`).join("\n");
}
