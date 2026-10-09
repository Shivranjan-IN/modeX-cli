import chalk from "chalk";

export const ORANGE = "#ff8c00";

export function orange(text: string): string {
	return chalk.hex(ORANGE)(text);
}

export const ORANGE_GRADIENT = ["#ffe0b3", "#ffcc80", "#ffb347", "#ff9f1c", "#ff8c00", "#e67300"];
