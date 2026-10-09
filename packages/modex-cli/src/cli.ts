#!/usr/bin/env node
import { main } from "./main.js";

main(process.argv.slice(2)).catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exit(1);
});
