import type { ModexModel } from "@modex/ai";
import chalk from "chalk";
import { ORANGE_GRADIENT, orange } from "./colors.js";

const FULL_LOGO_LINES = [
	"███╗   ███╗ ██████╗ ██████╗ ███████╗██╗  ██╗",
	"████╗ ████║██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝",
	"██╔████╔██║██║   ██║██║  ██║█████╗   ╚███╔╝ ",
	"██║╚██╔╝██║██║   ██║██║  ██║██╔══╝   ██╔██╗ ",
	"██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗██╔╝ ██╗",
	"╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝",
];

const COMPACT_LOGO_LINES = ["█▄▄ █▀█ █▀█ █▀▄▀█ █▀▀ █▀▀", "█▄█ █▄█ █▄█ █▀▄▀█ ██▄ █▄▄"];

const TAGLINE_1 = "ONE CLI. EVERY MODEL.";
const TAGLINE_2 = "FREE-FIRST CODING.";

export interface WelcomeOptions {
	version: string;
	cwd: string;
	model?: ModexModel;
	hasProviderKey?: boolean;
	paidOptIn?: boolean;
	width?: number;
}

function padLeft(plain: string, width: number): string {
	const pad = Math.max(0, Math.floor((width - plain.length) / 2));
	return " ".repeat(pad);
}

function colorizeLogoLine(plain: string, index: number): string {
	const color = ORANGE_GRADIENT[Math.min(index, ORANGE_GRADIENT.length - 1)];
	return chalk.hex(color)(plain);
}

function displayModelId(model: ModexModel): string {
	return model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
}

export function renderWelcome(options: WelcomeOptions): void {
	const width = options.width ?? process.stdout.columns ?? 80;
	const out = (line = "") => process.stdout.write(`${line}\n`);

	const useFull = width >= FULL_LOGO_LINES[0].length + 4;
	const plainLogo = useFull ? FULL_LOGO_LINES : COMPACT_LOGO_LINES;

	out();
	for (let i = 0; i < plainLogo.length; i++) {
		const plain = plainLogo[i];
		const line = useFull ? colorizeLogoLine(plain, i) : chalk.bold.blue(plain);
		out(`${padLeft(plain, width)}${line}`);
	}

	out();
	out(`${padLeft(TAGLINE_1, width)}${chalk.dim(TAGLINE_1)}`);
	out(`${padLeft(TAGLINE_2, width)}${orange(TAGLINE_2)}`);

	out();
	out(`${orange("  Welcome to Modex!")}  ${chalk.dim(`v${options.version}`)}`);
	out();

	const modelValue = options.model
		? chalk.cyan(displayModelId(options.model)) +
			(options.model.freeMetadata.freeEligibility === "free" ? chalk.green(" [free]") : chalk.yellow(" [paid]"))
		: chalk.dim("Not configured");
	const providerValue = options.model
		? chalk.cyan(options.model.provider) +
			" " +
			(options.hasProviderKey ? chalk.green("(key ✓)") : chalk.yellow("(no key)"))
		: chalk.dim("Not configured");
	const routingValue = options.paidOptIn
		? chalk.yellow("Free-first (paid opt-in enabled)")
		: chalk.green("Free-first") + chalk.dim(" (paid requires --paid)");

	out(`  ${chalk.dim("Model       ")}${modelValue}`);
	out(`  ${chalk.dim("Provider    ")}${providerValue}`);
	out(`  ${chalk.dim("Routing     ")}${routingValue}`);
	out(`  ${chalk.dim("Directory   ")}${chalk.white(options.cwd)}`);
	out();
	out(`  ${chalk.dim("Type a message to start coding.")}`);
	out(`  ${chalk.dim("Use /help to see available commands.")}`);
	out();
}
