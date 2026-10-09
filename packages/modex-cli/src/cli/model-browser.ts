import type { ModexModel, ModexRuntime } from "@modex/ai";
import { getTheme } from "./themes.js";

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";
const BOX_L = "├";
const BOX_R = "┤";
const _BOX_T = "┬";
const _BOX_B = "┴";
const _BOX_X = "┼";

export interface ModelBrowserOptions {
	runtime: ModexRuntime;
	paidOptIn: boolean;
	currentModel?: ModexModel;
	width?: number;
	height?: number;
}

export interface ModelBrowserState {
	models: ModexModel[];
	filtered: ModexModel[];
	selectedIndex: number;
	scrollOffset: number;
	searchQuery: string;
	filterProvider: string | null;
	showPaid: boolean;
	width: number;
	height: number;
	currentModel?: ModexModel;
}

function getVisibleLines(state: ModelBrowserState): number {
	return state.height - 8;
}

export function createModelBrowser(options: ModelBrowserOptions): ModelBrowserState {
	const { runtime, paidOptIn, currentModel, width = 100, height = 30 } = options;
	const free = runtime.router.getFreeEligibleModels();
	const paid = paidOptIn ? runtime.router.getPaidModels() : [];
	const all = [...free, ...paid];

	return {
		models: all,
		filtered: all,
		selectedIndex: 0,
		scrollOffset: 0,
		searchQuery: "",
		filterProvider: null,
		showPaid: paidOptIn,
		width,
		height,
		currentModel,
	};
}

export function applyFilters(state: ModelBrowserState): void {
	let filtered = state.models;

	if (state.searchQuery) {
		const q = state.searchQuery.toLowerCase();
		filtered = filtered.filter(
			(m) =>
				m.id.toLowerCase().includes(q) ||
				m.provider.toLowerCase().includes(q) ||
				(m.name?.toLowerCase().includes(q) ?? false),
		);
	}

	if (state.filterProvider) {
		filtered = filtered.filter((m) => m.provider === state.filterProvider);
	}

	if (!state.showPaid) {
		filtered = filtered.filter((m) => m.freeMetadata.freeEligibility === "free");
	}

	state.filtered = filtered;
	state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.filtered.length - 1));
}

export function navigateModelBrowser(
	state: ModelBrowserState,
	direction: "up" | "down" | "pageup" | "pagedown" | "home" | "end",
): void {
	const visible = getVisibleLines(state);

	switch (direction) {
		case "up":
			state.selectedIndex = Math.max(0, state.selectedIndex - 1);
			break;
		case "down":
			state.selectedIndex = Math.min(state.filtered.length - 1, state.selectedIndex + 1);
			break;
		case "pageup":
			state.selectedIndex = Math.max(0, state.selectedIndex - visible);
			break;
		case "pagedown":
			state.selectedIndex = Math.min(state.filtered.length - 1, state.selectedIndex + visible);
			break;
		case "home":
			state.selectedIndex = 0;
			break;
		case "end":
			state.selectedIndex = state.filtered.length - 1;
			break;
	}

	if (state.selectedIndex < state.scrollOffset) {
		state.scrollOffset = state.selectedIndex;
	} else if (state.selectedIndex >= state.scrollOffset + visible) {
		state.scrollOffset = state.selectedIndex - visible + 1;
	}
}

export function setSearchQuery(state: ModelBrowserState, query: string): void {
	state.searchQuery = query;
	applyFilters(state);
}

export function setProviderFilter(state: ModelBrowserState, provider: string | null): void {
	state.filterProvider = provider;
	applyFilters(state);
}

export function togglePaidFilter(state: ModelBrowserState): void {
	state.showPaid = !state.showPaid;
	applyFilters(state);
}

export function getSelectedModel(state: ModelBrowserState): ModexModel | undefined {
	return state.filtered[state.selectedIndex];
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function _truncate(str: string, max: number): string {
	const visible = stripAnsi(str);
	if (visible.length <= max) return str;
	return `${str.slice(0, max - 1)}…`;
}

function renderModelLine(
	model: ModexModel,
	index: number,
	isSelected: boolean,
	isCurrent: boolean,
	theme: ReturnType<typeof getTheme>,
	width: number,
): string {
	const innerW = width - 4;
	const prefix = isCurrent ? theme.success("► ") : isSelected ? theme.brand("► ") : "  ";
	const num = theme.dim(`${index + 1}.`.padStart(4));
	const modelLabel = model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
	const _keyTag = "✓";
	const ctxTag = theme.dim(`(${Math.round(model.contextWindow / 1000)}k)`);
	const freeTag = model.freeMetadata.freeEligibility === "free" ? theme.success(" FREE") : theme.warning(" PAID");
	const toolTag = model.freeMetadata.capabilities?.includes("tool-calling") ? theme.info(" 🔧") : "";
	const providerTag = theme.provider(`[${model.provider}]`);

	let content = `${prefix}${num} ${theme.model(modelLabel)} ${ctxTag} ${providerTag}${freeTag}${toolTag}`;
	if (isCurrent) content = theme.success("✓ ") + content.slice(2);

	const visibleLen = stripAnsi(content).length;
	const pad = Math.max(0, innerW - visibleLen);
	const border = isSelected ? theme.border(BOX_V) : theme.borderDim(BOX_V);
	return `${border} ${content}${" ".repeat(pad)} ${border}`;
}

export function renderModelBrowser(state: ModelBrowserState): string[] {
	const theme = getTheme();
	const lines: string[] = [];
	const innerW = state.width - 4;
	const visible = getVisibleLines(state);

	const title = " MODEL BROWSER ";
	const titlePad = Math.max(0, innerW - title.length);
	const leftPad = Math.floor(titlePad / 2);
	const rightPad = titlePad - leftPad;
	lines.push(
		`${theme.border(BOX_TL)}${theme.border(BOX_H.repeat(leftPad))}${theme.brand(title)}${theme.border(BOX_H.repeat(rightPad))}${theme.border(BOX_TR)}`,
	);

	const searchLine = ` Search: ${theme.brand(state.searchQuery || "")}  │  Provider: ${theme.provider(state.filterProvider || "all")}  │  Paid: ${state.showPaid ? theme.success("on") : theme.dim("off")}  │  ${theme.dim("↑↓ nav • / search • p provider • $ paid • Enter select • Esc back")}`;
	const searchPad = Math.max(0, innerW - stripAnsi(searchLine).length);
	lines.push(`${theme.border(BOX_V)} ${searchLine}${" ".repeat(searchPad)} ${theme.border(BOX_V)}`);

	lines.push(`${theme.border(BOX_L)}${theme.border(BOX_H.repeat(innerW))}${theme.border(BOX_R)}`);

	if (state.filtered.length === 0) {
		const empty = theme.dim("No models match current filters");
		const pad = Math.max(0, innerW - stripAnsi(empty).length);
		lines.push(`${theme.border(BOX_V)} ${empty}${" ".repeat(pad)} ${theme.border(BOX_V)}`);
	} else {
		const start = state.scrollOffset;
		const end = Math.min(start + visible, state.filtered.length);
		for (let i = start; i < end; i++) {
			const model = state.filtered[i];
			const globalIndex = state.models.indexOf(model);
			const isSelected = i === state.selectedIndex;
			const isCurrent = model === state.currentModel;
			lines.push(renderModelLine(model, globalIndex, isSelected, isCurrent, theme, state.width));
		}
		for (let i = end - start; i < visible; i++) {
			lines.push(`${theme.border(BOX_V)}${" ".repeat(innerW + 2)}${theme.border(BOX_V)}`);
		}
	}

	lines.push(`${theme.border(BOX_BL)}${theme.border(BOX_H.repeat(innerW))}${theme.border(BOX_BR)}`);
	return lines;
}
