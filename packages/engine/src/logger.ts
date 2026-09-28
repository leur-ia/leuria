export interface Logger {
	info: (msg: string, meta?: Record<string, unknown>) => void;
	warn: (msg: string, meta?: Record<string, unknown>) => void;
	error: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Line-per-event logger on stderr, so stdout stays free. */
export function createLogger(verbose = false): Logger {
	const write =
		(level: string) => (msg: string, meta?: Record<string, unknown>) => {
			if (level === "info" && !verbose) return;
			const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
			process.stderr.write(
				`${new Date().toISOString()} ${level.padEnd(5)} ${msg}${suffix}\n`,
			);
		};
	return { info: write("info"), warn: write("warn"), error: write("error") };
}
