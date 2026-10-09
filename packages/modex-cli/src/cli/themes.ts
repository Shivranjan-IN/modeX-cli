import chalk from "chalk";

export interface Theme {
	name: string;
	brand: (text: string) => string;
	brandDim: (text: string) => string;
	success: (text: string) => string;
	warning: (text: string) => string;
	error: (text: string) => string;
	info: (text: string) => string;
	dim: (text: string) => string;
	model: (text: string) => string;
	provider: (text: string) => string;
	border: (text: string) => string;
	borderDim: (text: string) => string;
	prompt: (text: string) => string;
	code: (text: string) => string;
	link: (text: string) => string;
}

const _orange = (hex: string) => (text: string) => chalk.hex(hex)(text);

const makeTheme = (colors: {
	brand: string;
	brandDim: string;
	success: string;
	warning: string;
	error: string;
	info: string;
	model: string;
	provider: string;
	border: string;
	prompt: string;
}): Theme => ({
	name: "",
	brand: (t) => chalk.hex(colors.brand)(t),
	brandDim: (t) => chalk.hex(colors.brandDim)(t),
	success: (t) => chalk.hex(colors.success)(t),
	warning: (t) => chalk.hex(colors.warning)(t),
	error: (t) => chalk.hex(colors.error)(t),
	info: (t) => chalk.hex(colors.info)(t),
	dim: chalk.dim,
	model: (t) => chalk.hex(colors.model)(t),
	provider: (t) => chalk.hex(colors.provider)(t),
	border: (t) => chalk.hex(colors.border)(t),
	borderDim: (t) => chalk.hex(colors.border).dim(t),
	prompt: (t) => chalk.hex(colors.prompt)(t),
	code: (t) => chalk.gray(t),
	link: (t) => chalk.underline(t),
});

export const themes: Record<string, Theme> = {
	orange: {
		...makeTheme({
			brand: "#ff8c00",
			brandDim: "#cc7000",
			success: "#22c55e",
			warning: "#fbbf24",
			error: "#ef4444",
			info: "#3b82f6",
			model: "#22d3ee",
			provider: "#f97316",
			border: "#ff8c00",
			prompt: "#ff8c00",
		}),
		name: "orange",
	},

	blue: {
		...makeTheme({
			brand: "#3b82f6",
			brandDim: "#2563eb",
			success: "#22c55e",
			warning: "#fbbf24",
			error: "#ef4444",
			info: "#06b6d4",
			model: "#22d3ee",
			provider: "#8b5cf6",
			border: "#3b82f6",
			prompt: "#3b82f6",
		}),
		name: "blue",
	},

	green: {
		...makeTheme({
			brand: "#22c55e",
			brandDim: "#16a34a",
			success: "#22c55e",
			warning: "#fbbf24",
			error: "#ef4444",
			info: "#3b82f6",
			model: "#4ade80",
			provider: "#16a34a",
			border: "#22c55e",
			prompt: "#22c55e",
		}),
		name: "green",
	},

	purple: {
		...makeTheme({
			brand: "#a855f7",
			brandDim: "#9333ea",
			success: "#22c55e",
			warning: "#fbbf24",
			error: "#ef4444",
			info: "#06b6d4",
			model: "#c084fc",
			provider: "#d946ef",
			border: "#a855f7",
			prompt: "#a855f7",
		}),
		name: "purple",
	},

	cyan: {
		...makeTheme({
			brand: "#06b6d4",
			brandDim: "#0891b2",
			success: "#22c55e",
			warning: "#fbbf24",
			error: "#ef4444",
			info: "#22d3ee",
			model: "#22d3ee",
			provider: "#0891b2",
			border: "#06b6d4",
			prompt: "#06b6d4",
		}),
		name: "cyan",
	},

	monochrome: {
		...makeTheme({
			brand: "#ffffff",
			brandDim: "#888888",
			success: "#ffffff",
			warning: "#aaaaaa",
			error: "#ffffff",
			info: "#888888",
			model: "#ffffff",
			provider: "#aaaaaa",
			border: "#666666",
			prompt: "#ffffff",
		}),
		name: "monochrome",
	},
};

let currentTheme = themes.orange;

export function getTheme(): Theme {
	return currentTheme;
}

export function setTheme(name: string): boolean {
	if (themes[name]) {
		currentTheme = themes[name];
		return true;
	}
	return false;
}

export function getThemeNames(): string[] {
	return Object.keys(themes);
}

export function formatWithTheme(text: string, style: keyof Theme): string {
	const fn = currentTheme[style];
	if (typeof fn === "function") return fn(text);
	return text;
}
