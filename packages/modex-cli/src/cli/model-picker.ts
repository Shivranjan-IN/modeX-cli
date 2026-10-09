import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ModexModel, ModexRuntime } from "@modex/ai";
import chalk from "chalk";
import { orange } from "./colors.js";

export interface ModelChoice {
	model: ModexModel;
	label: string;
}

const BOX_TOP_LEFT = "┌";
const BOX_TOP_RIGHT = "┐";
const BOX_BOTTOM_LEFT = "└";
const BOX_BOTTOM_RIGHT = "┘";
const BOX_HORIZONTAL = "─";
const BOX_VERTICAL = "│";

function getTerminalWidth(): number {
	return process.stdout.columns ?? 80;
}

export function getModelChoices(runtime: ModexRuntime, paidOptIn: boolean): ModexModel[] {
	const free = runtime.router.getFreeEligibleModels();
	const paid = paidOptIn ? runtime.router.getPaidModels() : [];
	return [...free, ...paid];
}

function drawModelSelectorBox(
	models: ModexModel[],
	current?: ModexModel,
	hasKey?: (provider: string) => boolean,
	width: number = 60,
): string[] {
	const lines: string[] = [];
	const innerWidth = width - 4;
	const title = " MODEL SELECTOR ";
	const titlePad = Math.max(0, innerWidth - title.length);
	const leftPad = Math.floor(titlePad / 2);
	const rightPad = titlePad - leftPad;

	lines.push(
		`${BOX_TOP_LEFT}${BOX_HORIZONTAL.repeat(leftPad)}${chalk.bold(title)}${BOX_HORIZONTAL.repeat(rightPad)}${BOX_TOP_RIGHT}`,
	);

	const freeModels = models.filter((m) => m.freeMetadata.freeEligibility === "free");
	const paidModels = models.filter((m) => m.freeMetadata.freeEligibility === "paid");

	if (freeModels.length > 0) {
		lines.push(`${BOX_VERTICAL} ${chalk.bold("Free models:")}${" ".repeat(innerWidth - 13)}${BOX_VERTICAL}`);
		for (let i = 0; i < freeModels.length; i++) {
			const m = freeModels[i];
			const isCurrent = current && m.id === current.id && m.provider === current.provider;
			const prefix = isCurrent ? chalk.green("► ") : "  ";
			const num = chalk.dim(`${i + 1}.`);
			const modelLabel = m.id.startsWith(`${m.provider}/`) ? m.id : `${m.provider}/${m.id}`;
			const keyTag = hasKey?.(m.provider) ? chalk.green("✓") : chalk.yellow("✗");
			const ctxTag = chalk.dim(`(${m.contextWindow / 1000}k)`);
			const lineContent = `${prefix}${num} ${chalk.cyan(modelLabel)} ${ctxTag} ${keyTag}`;
			const visibleLen = lineContent.replace(/\x1b\[[0-9;]*m/g, "").length;
			const pad = Math.max(0, innerWidth - visibleLen);
			lines.push(`${BOX_VERTICAL} ${lineContent}${" ".repeat(pad)} ${BOX_VERTICAL}`);
		}
	}

	if (paidModels.length > 0) {
		lines.push(
			`${BOX_VERTICAL} ${chalk.bold.yellow("Paid models (require --paid):")}${" ".repeat(innerWidth - 29)}${BOX_VERTICAL}`,
		);
		for (let i = 0; i < paidModels.length; i++) {
			const m = paidModels[i];
			const isCurrent = current && m.id === current.id && m.provider === current.provider;
			const prefix = isCurrent ? chalk.green("► ") : "  ";
			const num = chalk.dim(`${freeModels.length + i + 1}.`);
			const modelLabel = m.id.startsWith(`${m.provider}/`) ? m.id : `${m.provider}/${m.id}`;
			const ctxTag = chalk.dim(`(${m.contextWindow / 1000}k)`);
			const lineContent = `${prefix}${num} ${chalk.yellow(modelLabel)} ${ctxTag}`;
			const visibleLen = lineContent.replace(/\x1b\[[0-9;]*m/g, "").length;
			const pad = Math.max(0, innerWidth - visibleLen);
			lines.push(`${BOX_VERTICAL} ${lineContent}${" ".repeat(pad)} ${BOX_VERTICAL}`);
		}
	}

	lines.push(
		`${BOX_VERTICAL} ${chalk.dim("Enter number, or type to filter:")}${" ".repeat(innerWidth - 30)} ${BOX_VERTICAL}`,
	);
	lines.push(`${BOX_BOTTOM_LEFT}${BOX_HORIZONTAL.repeat(innerWidth)}${BOX_BOTTOM_RIGHT}`);

	return lines;
}

export function renderModelChoices(
	models: ModexModel[],
	current?: ModexModel,
	hasKey?: (provider: string) => boolean,
	width?: number,
): void {
	const w = width ?? Math.min(getTerminalWidth(), 80);
	const boxLines = drawModelSelectorBox(models, current, hasKey, w);
	process.stdout.write(`\n${boxLines.join("\n")}\n`);
}

export async function pickModelInteractive(options: {
	runtime: ModexRuntime;
	paidOptIn: boolean;
	current?: ModexModel;
}): Promise<ModexModel | undefined> {
	const models = getModelChoices(options.runtime, options.paidOptIn);
	if (models.length === 0) return undefined;

	const width = Math.min(getTerminalWidth(), 80);
	renderModelChoices(models, options.current, (p) => options.runtime.isProviderAvailable(p), width);

	const rl = createInterface({ input: stdin, output: stdout, terminal: true });

	try {
		const answer = await rl.question(`${orange("Select model #: ")}`);
		const num = parseInt(answer.trim(), 10);
		if (Number.isFinite(num) && num >= 1 && num <= models.length) {
			return models[num - 1];
		}
		return undefined;
	} finally {
		rl.close();
	}
}
