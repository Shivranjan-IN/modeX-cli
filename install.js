#!/usr/bin/env node
// Modex CLI - Standalone installer
// Run: node install.js [--global] [--version=latest]

import { spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const isGlobal = args.includes("--global") || args.includes("-g");
const versionArg = args.find(a => a.startsWith("--version="));
const version = versionArg ? versionArg.split("=")[1] : "latest";

const BLUE = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

function log(...args: string[]) { console.log(`${BLUE}[modex]${NC}`, ...args); }
function success(...args: string[]) { console.log(`${GREEN}[modex]${NC}`, ...args); }
function warn(...args: string[]) { console.log(`${YELLOW}[modex]${NC}`, ...args); }
function error(...args: string[]) { console.error(`${RED}[modex]${NC}`, ...args); }

function run(cmd: string, opts: { cwd?: string; stdio?: "inherit" | "pipe" } = {}): { stdout: string; stderr: string; code: number } {
	const result = spawnSync("bash", ["-c", cmd], { cwd: opts.cwd ?? ROOT, stdio: opts.stdio ?? "pipe", encoding: "utf8" });
	return { stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "", code: result.status ?? 1 };
}

function checkNode(): boolean {
	const v = process.version;
	const major = parseInt(v.slice(1).split(".")[0], 10);
	if (major < 22) {
		error(`Node.js 22+ required. Found: ${v}`);
		return false;
	}
	log(`Node.js ${v} ✓`);
	return true;
}

function buildAll(): boolean {
	log("Building all packages...");
	const r = run("npm run build", { stdio: "inherit" });
	if (r.code !== 0) {
		error("Build failed");
		return false;
	}
	success("Build complete");
	return true;
}

function installGlobal(): boolean {
	log("Installing globally via npm link...");
	const r = run("npm link", { stdio: "inherit" });
	if (r.code !== 0) {
		error("npm link failed");
		return false;
	}
	success("Modex CLI linked globally as 'modex'");
	return true;
}

function createBinWrapper(): boolean {
	const binDir = join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".modex", "bin");
	mkdirSync(binDir, { recursive: true });
	const cliPath = join(ROOT, "packages", "modex-cli", "dist", "cli.js");
	const wrapperPath = join(binDir, "modex");
	const wrapper = `#!/usr/bin/env node
require('${cliPath.replace(/\\/g, "\\\\")}');
`;
	writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
	log(`Created wrapper at ${wrapperPath}`);
	success(`Add to PATH: export PATH="\$HOME/.modex/bin:\$PATH"`);
	return true;
}

function main() {
	console.log(`
${BLUE}███╗   ███╗ ██████╗ ██████╗ ███████╗██╗  ██╗
████╗ ████║██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
██╔████╔██║██║   ██║██║  ██║█████╗   ╚███╔╝ 
██║╚██╔╝██║██║   ██║██║  ██║██╔══╝   ██╔██╗ 
██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗██╔╝ ██╗
╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝
        ONE CLI. EVERY MODEL. FREE-FIRST.${NC}
`);

	if (!checkNode()) process.exit(1);

	if (!buildAll()) process.exit(1);

	if (isGlobal) {
		if (!installGlobal()) process.exit(1);
	} else {
		if (!createBinWrapper()) process.exit(1);
	}

	console.log(`
${GREEN}Modex CLI installed!${NC}

Quick start:
  modex                 # Interactive REPL
  modex --pick          # Choose model, then chat
  modex "your question" # One-shot

Free API keys (add to ~/.modex/.env):
  GROQ_API_KEY=gsk_...        https://console.groq.com/keys
  CEREBRAS_API_KEY=csk-...    https://cloud.cerebras.ai/
  NVIDIA_API_KEY=nvapi-...    https://build.nvidia.com/
  OPENROUTER_API_KEY=skor-... https://openrouter.ai/keys
`);
}

main();