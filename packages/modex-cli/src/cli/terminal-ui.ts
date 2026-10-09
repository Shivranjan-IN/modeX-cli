import chalk from "chalk";
import { ORANGE } from "./colors.js";

export interface TerminalSize {
	width: number;
	height: number;
}

export function getTerminalSize(): TerminalSize {
	return {
		width: process.stdout.columns ?? 80,
		height: process.stdout.rows ?? 24,
	};
}

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";
const _BOX_T = "┬";
const _BOX_B = "┴";
const _BOX_L = "├";
const _BOX_R = "┤";
const _BOX_X = "┼";

export interface HeaderInfo {
	brand: string;
	projectName: string;
	sessionId: string;
	model: string;
	provider: string;
	permissionMode: "yolo" | "ask" | "deny";
	isCompact: boolean;
}

export function renderHeader(info: HeaderInfo, width: number): string[] {
	const lines: string[] = [];
	const innerW = width - 2;

	if (info.isCompact) {
		const line = `${BOX_TL}${BOX_H.repeat(innerW)}${BOX_TR}`;
		const content = `${chalk.hex(ORANGE)(info.brand)}  ${chalk.dim(info.projectName)}  ${chalk.cyan(info.model)}  ${chalk.dim(info.provider)}  ${formatPerm(info.permissionMode)}`;
		const pad = Math.max(0, innerW - visibleLength(content));
		lines.push(line);
		lines.push(`${BOX_V} ${content}${" ".repeat(pad)} ${BOX_V}`);
		lines.push(`${BOX_BL}${BOX_H.repeat(innerW)}${BOX_BR}`);
		return lines;
	}

	const top = `${BOX_TL}${BOX_H.repeat(innerW)}${BOX_TR}`;
	lines.push(top);

	const brandLine = ` ${chalk.hex(ORANGE)(info.brand)}  ${chalk.dim(info.projectName)}`;
	const brandPad = Math.max(0, innerW - visibleLength(brandLine));
	lines.push(`${BOX_V}${brandLine}${" ".repeat(brandPad)} ${BOX_V}`);

	const sessionLine = ` Session: ${chalk.cyan(info.sessionId.slice(0, 12))}  Model: ${chalk.green(info.model)}  Provider: ${chalk.blue(info.provider)}  Perm: ${formatPerm(info.permissionMode)}`;
	const sessionPad = Math.max(0, innerW - visibleLength(sessionLine));
	lines.push(`${BOX_V}${sessionLine}${" ".repeat(sessionPad)} ${BOX_V}`);

	const bottom = `${BOX_BL}${BOX_H.repeat(innerW)}${BOX_BR}`;
	lines.push(bottom);

	return lines;
}

function formatPerm(mode: "yolo" | "ask" | "deny"): string {
	switch (mode) {
		case "yolo":
			return chalk.yellow("YOLO");
		case "ask":
			return chalk.green("ASK");
		case "deny":
			return chalk.red("DENY");
	}
}

export interface StatusInfo {
	model: string;
	provider: string;
	providerStatus: "ready" | "unavailable" | "rate-limited";
	routing: "free-first" | "paid";
	gitBranch?: string;
	taskStatus: "idle" | "thinking" | "tool" | "streaming" | "waiting";
	tokens?: { input: number; output: number; total: number; cost?: number };
	isCompact: boolean;
}

export function renderStatus(info: StatusInfo, width: number): string[] {
	const lines: string[] = [];
	const innerW = width - 2;

	if (info.isCompact) {
		const parts = [
			`Model: ${chalk.cyan(info.model)}`,
			`Provider: ${providerStatusTag(info.provider, info.providerStatus)}`,
			`Routing: ${info.routing === "free-first" ? chalk.green("Free-first") : chalk.yellow("Paid")}`,
			info.gitBranch ? `Git: ${chalk.magenta(info.gitBranch)}` : "",
			`Task: ${taskStatusTag(info.taskStatus)}`,
			info.tokens
				? `Tokens: ${chalk.dim(`${info.tokens.input}+${info.tokens.output}=${info.tokens.total}`)}${info.tokens.cost ? ` $${info.tokens.cost.toFixed(4)}` : ""}`
				: "",
		].filter(Boolean);
		const content = parts.join("  │  ");
		const line = `${BOX_TL}${BOX_H.repeat(innerW)}${BOX_TR}`;
		const pad = Math.max(0, innerW - visibleLength(content));
		lines.push(line);
		lines.push(`${BOX_V} ${content}${" ".repeat(pad)} ${BOX_V}`);
		lines.push(`${BOX_BL}${BOX_H.repeat(innerW)}${BOX_BR}`);
		return lines;
	}

	const top = `${BOX_TL}${BOX_H.repeat(innerW)}${BOX_TR}`;
	lines.push(top);

	const row1 = ` Model: ${chalk.bold.cyan(info.model)}  Provider: ${providerStatusTag(info.provider, info.providerStatus)}  Routing: ${info.routing === "free-first" ? chalk.green("Free-first") : chalk.yellow("Paid (opt-in)")}`;
	const row1Pad = Math.max(0, innerW - visibleLength(row1));
	lines.push(`${BOX_V}${row1}${" ".repeat(row1Pad)} ${BOX_V}`);

	const row2Parts = [
		info.gitBranch ? `Git: ${chalk.magenta(info.gitBranch)}` : "Git: —",
		`Task: ${taskStatusTag(info.taskStatus)}`,
		info.tokens
			? `Tokens: ${chalk.dim(`${info.tokens.input} in + ${info.tokens.output} out = ${info.tokens.total} total`)}${info.tokens.cost ? `  Cost: $${info.tokens.cost.toFixed(4)}` : ""}`
			: "Tokens: —",
	];
	const row2 = `  ${row2Parts.join("  │  ")}`;
	const row2Pad = Math.max(0, innerW - visibleLength(row2));
	lines.push(`${BOX_V}${row2}${" ".repeat(row2Pad)} ${BOX_V}`);

	const bottom = `${BOX_BL}${BOX_H.repeat(innerW)}${BOX_BR}`;
	lines.push(bottom);

	return lines;
}

function providerStatusTag(provider: string, status: "ready" | "unavailable" | "rate-limited"): string {
	const dot = status === "ready" ? chalk.green("●") : status === "rate-limited" ? chalk.yellow("●") : chalk.red("●");
	return `${dot} ${chalk.cyan(provider)} ${chalk.dim(`(${status})`)}`;
}

function taskStatusTag(status: "idle" | "thinking" | "tool" | "streaming" | "waiting"): string {
	const icons: Record<string, string> = {
		idle: chalk.green("⬤ Ready"),
		thinking: chalk.blue("◐ Thinking"),
		tool: chalk.yellow("⚙ Tool"),
		streaming: chalk.cyan("▶ Streaming"),
		waiting: chalk.magenta("⏳ Waiting"),
	};
	return icons[status] ?? status;
}

function stripAnsi(str: string): number {
	return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function visibleLength(str: string): number {
	return stripAnsi(str);
}

export interface InputAreaState {
	promptLines: string[];
	cursorLine: number;
	cursorCol: number;
	history: string[];
	historyIndex: number;
	placeholder: string;
	isMultiline: boolean;
}

export function createInputArea(): InputAreaState {
	return {
		promptLines: [""],
		cursorLine: 0,
		cursorCol: 0,
		history: [],
		historyIndex: 0,
		placeholder: "Type your message… (/help for commands, Ctrl+J for new line)",
		isMultiline: false,
	};
}

function drawInputBox(lines: string[], width: number, focused: boolean, placeholder: string): string[] {
	const innerW = width - 4;
	const boxLines: string[] = [];

	const topLeft = focused ? chalk.hex(ORANGE)(BOX_TL) : chalk.dim(BOX_TL);
	const topRight = focused ? chalk.hex(ORANGE)(BOX_TR) : chalk.dim(BOX_TR);
	const bottomLeft = focused ? chalk.hex(ORANGE)(BOX_BL) : chalk.dim(BOX_BL);
	const bottomRight = focused ? chalk.hex(ORANGE)(BOX_BR) : chalk.dim(BOX_BR);
	const h = focused ? chalk.hex(ORANGE)(BOX_H) : chalk.dim(BOX_H);
	const v = focused ? chalk.hex(ORANGE)(BOX_V) : chalk.dim(BOX_V);

	boxLines.push(`${topLeft}${h.repeat(innerW)}${topRight}`);

	if (lines.length === 1 && lines[0] === "") {
		const ph = chalk.dim(placeholder);
		const pad = Math.max(0, innerW - stripAnsi(ph));
		boxLines.push(`${v} ${ph}${" ".repeat(pad)} ${v}`);
	} else {
		for (const line of lines) {
			const pad = Math.max(0, innerW - stripAnsi(line));
			boxLines.push(`${v} ${line}${" ".repeat(pad)} ${v}`);
		}
	}

	boxLines.push(`${bottomLeft}${h.repeat(innerW)}${bottomRight}`);
	return boxLines;
}

export function renderInputArea(state: InputAreaState, width: number, focused: boolean): string[] {
	return drawInputBox(state.promptLines, width, focused, state.placeholder);
}

export function moveCursorUp(lines: number): string {
	return `\x1b[${lines}A`;
}

export function moveCursorDown(lines: number): string {
	return `\x1b[${lines}B`;
}

export function moveCursorTo(line: number, col: number): string {
	return `\x1b[${line + 1};${col + 1}H`;
}

export function clearLines(count: number): string {
	return "\x1b[2K\r".repeat(count);
}

export function hideCursor(): string {
	return "\x1b[?25l";
}

export function showCursor(): string {
	return "\x1b[?25h";
}

export function saveCursor(): string {
	return "\x1b[s";
}

export function restoreCursor(): string {
	return "\x1b[u";
}

export function clearScreen(): string {
	return "\x1b[2J\x1b[H";
}

export function alternateScreenEnter(): string {
	return "\x1b[?1049h";
}

export function alternateScreenExit(): string {
	return "\x1b[?1049l";
}
