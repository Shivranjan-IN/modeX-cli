import type { AgentTool } from "../types.js";
import { type BashToolOptions, createBashTool } from "./bash.js";
import { createEditTool, type EditToolOptions } from "./edit.js";
import { createGlobTool, type GlobToolOptions } from "./glob.js";
import { createGrepTool, type GrepToolOptions } from "./grep.js";
import { createLsTool, type LsToolOptions } from "./ls.js";
import { createReadTool, type ReadToolOptions } from "./read.js";
import { createWriteTool, type WriteToolOptions } from "./write.js";

export { createBashTool } from "./bash.js";
export { createEditTool } from "./edit.js";
export { createGlobTool } from "./glob.js";
export { createGrepTool } from "./grep.js";
export { createLsTool } from "./ls.js";
export { createReadTool } from "./read.js";
export { createWriteTool } from "./write.js";

export interface DefaultToolsOptions {
	cwd: string;
	bash?: Omit<BashToolOptions, "cwd">;
	read?: Omit<ReadToolOptions, "cwd">;
	write?: Omit<WriteToolOptions, "cwd">;
	edit?: Omit<EditToolOptions, "cwd">;
	ls?: Omit<LsToolOptions, "cwd">;
	grep?: Omit<GrepToolOptions, "cwd">;
	glob?: Omit<GlobToolOptions, "cwd">;
}

export function createDefaultTools(options: DefaultToolsOptions): AgentTool[] {
	const { cwd } = options;
	return [
		createReadTool({ cwd, ...options.read }),
		createWriteTool({ cwd, ...options.write }),
		createEditTool({ cwd, ...options.edit }),
		createBashTool({ cwd, ...options.bash }),
		createLsTool({ cwd, ...options.ls }),
		createGrepTool({ cwd, ...options.grep }),
		createGlobTool({ cwd, ...options.glob }),
	];
}
