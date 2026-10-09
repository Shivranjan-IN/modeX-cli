export interface CliArgs {
	help?: boolean;
	version?: boolean;
	provider?: string;
	model?: string;
	pick?: boolean;
	prompt: string[];
	paid?: boolean;
	continueSession?: boolean;
	resume?: string;
	yolo?: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
	const result: CliArgs = { prompt: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-V") {
			result.version = true;
		} else if (arg === "--provider" && i + 1 < argv.length) {
			result.provider = argv[++i];
		} else if (arg === "--model" && i + 1 < argv.length) {
			result.model = argv[++i];
		} else if (arg === "--pick") {
			result.pick = true;
		} else if (arg === "--paid") {
			result.paid = true;
		} else if (arg === "--continue" || arg === "-c") {
			result.continueSession = true;
		} else if (arg === "--resume" && i + 1 < argv.length) {
			result.resume = argv[++i];
		} else if (arg === "--yolo") {
			result.yolo = true;
		} else if (!arg.startsWith("-")) {
			result.prompt.push(arg);
		}
	}
	return result;
}

export function printHelp(): void {
	console.log(`modex - free-first AI coding agent

Usage:
  modex                      Start interactive REPL
  modex "<prompt>"           Run a single prompt and exit
  modex --continue           Continue the most recent session
  modex --resume <id>        Resume a session by id

Model selection (free-first by default):
  --provider <name>          Prefer a provider (groq, cerebras, together, fireworks, openrouter, nvidia, openai)
  --model <pattern>          Prefer models matching a substring (e.g. "llama", "qwen")
  --pick                     Interactively pick a model at startup
  --paid                     Explicitly opt in to paid models (never automatic)

Other:
  --yolo                     Skip all tool permission prompts (dangerous)
  --help, -h                 Show this help
  --version, -V              Show version

API keys — put them in ~/.modex/.env (global) or ./.env (this project):
  GROQ_API_KEY, CEREBRAS_API_KEY, TOGETHER_API_KEY,
  FIREWORKS_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY

Paid providers (require --paid):
  OPENAI_API_KEY

REPL commands:
  /help          Show help
  /models        List available models (free vs paid)
  /model [pattern]   Switch model or run /model for interactive picker
  /sessions      List saved sessions
  /new           Start a fresh session
  /quit          Exit (alias: /exit)

Examples:
  modex "list all TypeScript files in src/"
  modex --provider groq --model llama "explain this project"
  modex --pick
  modex --paid --model gpt-5 "refactor this function carefully"
`);
}
