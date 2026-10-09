export interface InputState {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
	history: string[];
	historyIndex: number;
	isMultiline: boolean;
}

export function createInputState(): InputState {
	return {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0,
		history: [],
		historyIndex: 0,
		isMultiline: false,
	};
}

export function addToHistory(state: InputState, input: string): void {
	const trimmed = input.trim();
	if (trimmed && (state.history.length === 0 || state.history[state.history.length - 1] !== trimmed)) {
		state.history.push(trimmed);
		if (state.history.length > 1000) state.history.shift();
	}
	state.historyIndex = state.history.length;
}

export function handleKeypress(
	state: InputState,
	key: { name: string; ctrl: boolean; shift: boolean; sequence: string },
	onSubmit: (input: string) => void,
	onHistoryUp: () => void,
	onHistoryDown: () => void,
	onToggleMultiline: () => void,
): boolean {
	const { name, ctrl, shift, sequence } = key;

	if (ctrl && name === "c") {
		process.exit(0);
		return true;
	}

	if (ctrl && name === "j") {
		onToggleMultiline();
		return true;
	}

	if (name === "return" && !shift) {
		if (state.isMultiline) {
			state.lines.splice(state.cursorLine + 1, 0, "");
			state.cursorLine++;
			state.cursorCol = 0;
		} else {
			const input = state.lines.join("\n").trim();
			if (input) {
				onSubmit(input);
				addToHistory(state, input);
				state.lines = [""];
				state.cursorLine = 0;
				state.cursorCol = 0;
			}
		}
		return true;
	}

	if (name === "backspace") {
		if (state.cursorCol > 0) {
			const line = state.lines[state.cursorLine];
			state.lines[state.cursorLine] = line.slice(0, state.cursorCol - 1) + line.slice(state.cursorCol);
			state.cursorCol--;
		} else if (state.cursorLine > 0) {
			const prevLine = state.lines[state.cursorLine - 1];
			state.cursorCol = prevLine.length;
			state.lines[state.cursorLine - 1] += state.lines[state.cursorLine];
			state.lines.splice(state.cursorLine, 1);
			state.cursorLine--;
		}
		return true;
	}

	if (name === "delete") {
		const line = state.lines[state.cursorLine];
		if (state.cursorCol < line.length) {
			state.lines[state.cursorLine] = line.slice(0, state.cursorCol) + line.slice(state.cursorCol + 1);
		} else if (state.cursorLine < state.lines.length - 1) {
			state.lines[state.cursorLine] += state.lines[state.cursorLine + 1];
			state.lines.splice(state.cursorLine + 1, 1);
		}
		return true;
	}

	if (name === "left") {
		if (state.cursorCol > 0) {
			state.cursorCol--;
		} else if (state.cursorLine > 0) {
			state.cursorLine--;
			state.cursorCol = state.lines[state.cursorLine].length;
		}
		return true;
	}

	if (name === "right") {
		const line = state.lines[state.cursorLine];
		if (state.cursorCol < line.length) {
			state.cursorCol++;
		} else if (state.cursorLine < state.lines.length - 1) {
			state.cursorLine++;
			state.cursorCol = 0;
		}
		return true;
	}

	if (name === "up") {
		if (state.cursorLine > 0) {
			state.cursorLine--;
			state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorLine].length);
		} else {
			onHistoryUp();
		}
		return true;
	}

	if (name === "down") {
		if (state.cursorLine < state.lines.length - 1) {
			state.cursorLine++;
			state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorLine].length);
		} else {
			onHistoryDown();
		}
		return true;
	}

	if (name === "home") {
		state.cursorCol = 0;
		return true;
	}

	if (name === "end") {
		state.cursorCol = state.lines[state.cursorLine].length;
		return true;
	}

	if (ctrl && name === "a") {
		state.cursorCol = 0;
		return true;
	}

	if (ctrl && name === "e") {
		state.cursorCol = state.lines[state.cursorLine].length;
		return true;
	}

	if (ctrl && name === "k") {
		state.lines[state.cursorLine] = state.lines[state.cursorLine].slice(0, state.cursorCol);
		return true;
	}

	if (ctrl && name === "u") {
		state.lines[state.cursorLine] = state.lines[state.cursorLine].slice(state.cursorCol);
		state.cursorCol = 0;
		return true;
	}

	if (ctrl && name === "w") {
		const line = state.lines[state.cursorLine];
		const before = line.slice(0, state.cursorCol);
		const lastWord = before.match(/\s*\S+$/);
		if (lastWord) {
			state.lines[state.cursorLine] = before.slice(0, -lastWord[0].length) + line.slice(state.cursorCol);
			state.cursorCol -= lastWord[0].length;
		}
		return true;
	}

	if (sequence && sequence.length === 1 && !ctrl && !shift) {
		const line = state.lines[state.cursorLine];
		state.lines[state.cursorLine] = line.slice(0, state.cursorCol) + sequence + line.slice(state.cursorCol);
		state.cursorCol++;
		return true;
	}

	if (sequence === "\t") {
		onTabComplete();
		return true;
	}

	return false;
}

let onTabComplete: () => void = () => {};

export function setTabCompleteHandler(handler: () => void): void {
	onTabComplete = handler;
}

export function getInputText(state: InputState): string {
	return state.lines.join("\n");
}

export function setInputText(state: InputState, text: string): void {
	state.lines = text.split("\n");
	state.cursorLine = state.lines.length - 1;
	state.cursorCol = state.lines[state.cursorLine].length;
}

export function clearInput(state: InputState): void {
	state.lines = [""];
	state.cursorLine = 0;
	state.cursorCol = 0;
}

export function toggleMultiline(state: InputState): void {
	state.isMultiline = !state.isMultiline;
	if (!state.isMultiline && state.lines.length > 1) {
		const joined = state.lines.join(" ");
		state.lines = [joined];
		state.cursorLine = 0;
		state.cursorCol = joined.length;
	}
}

export function navigateHistory(state: InputState, direction: "up" | "down"): void {
	if (state.history.length === 0) return;

	if (direction === "up") {
		if (state.historyIndex > 0) state.historyIndex--;
	} else {
		if (state.historyIndex < state.history.length - 1) state.historyIndex++;
		else return;
	}

	const entry = state.history[state.historyIndex];
	if (entry) {
		setInputText(state, entry);
	}
}
