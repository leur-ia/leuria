/**
 * Run a command in a terminal window the visitor can see and type in: the
 * sign-in some agents only offer on the command line (Claude's
 * `auth login`), from the desktop app, which has no terminal of its own.
 *
 * The command goes in a small script that writes its exit code to a file
 * when it ends; Leuria waits for that file. A window's own process can't be
 * waited on: `start` (Windows) and `open` (macOS) return at once.
 */

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeScratch } from "./scratch.js";

interface TerminalWindowOptions {
	/** The window's title, and its first line: what it is for, in plain words. */
	title: string;
	command: string;
	args: string[];
	/** Set in the window. On macOS the window starts from the login shell, not from Leuria. */
	env: Record<string, string>;
	cwd: string;
	signal?: AbortSignal;
}

/** Give up after this long. */
const TIMEOUT_MS = 15 * 60_000;

/** Can Leuria open a terminal window here? */
export function canOpenTerminalWindow(): boolean {
	return process.platform === "win32" || process.platform === "darwin";
}

/** Open the window and wait until the command in it ends: its exit code, or null if stopped or given up. */
export async function runInTerminalWindow(options: TerminalWindowOptions): Promise<number | null> {
	if (!canOpenTerminalWindow()) throw new Error("Leuria can't open a terminal window on this system");
	const dir = mkdtempSync(join(tmpdir(), "leuria-window-"));
	const done = join(dir, "exit-code");
	try {
		if (process.platform === "win32") {
			const script = join(dir, "sign-in.cmd");
			writeFileSync(script, windowsScript(options, done), "utf-8");
			// `start` opens a new console window; the title is its first quoted argument.
			spawn("cmd.exe", ["/d", "/c", `start "${options.title.replaceAll('"', "")}" "${script}"`], {
				detached: true,
				stdio: "ignore",
				windowsHide: false,
				windowsVerbatimArguments: true,
			}).unref();
		} else {
			const script = join(dir, "sign-in.command");
			writeFileSync(script, macScript(options, done), "utf-8");
			chmodSync(script, 0o700);
			spawn("open", ["-a", "Terminal", script], { detached: true, stdio: "ignore" }).unref();
		}
		return await waitFor(done, options.signal, TIMEOUT_MS);
	} finally {
		removeScratch(dir);
	}
}

function waitFor(file: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<number | null> {
	return new Promise((resolve) => {
		const finish = (code: number | null) => {
			clearInterval(poll);
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(code);
		};
		const onAbort = () => finish(null);
		const poll = setInterval(() => {
			if (!existsSync(file)) return;
			const code = Number.parseInt(readFileSync(file, "utf-8").trim(), 10);
			finish(Number.isNaN(code) ? null : code);
		}, 1000);
		const timer = setTimeout(() => finish(null), timeoutMs);
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** A .cmd script, UTF-8 (chcp 65001) so paths with accents stay whole. Exported for tests. */
export function windowsScript(options: TerminalWindowOptions, done: string): string {
	// In a .cmd file `%` starts a variable: double it. Quotes keep `&`, `|` and `^` literal.
	const text = (value: string) => value.replaceAll("%", "%%");
	const quote = (value: string) => `"${text(value).replaceAll('"', '""')}"`;
	return [
		"@echo off",
		"chcp 65001 >nul",
		`title ${text(options.title).replace(/[&|<>^]/g, "")}`,
		`echo ${text(options.title).replace(/[&|<>^]/g, "")}`,
		"echo Leuria opened this window. Follow the steps below: it closes by itself when you're done.",
		"echo.",
		`cd /d ${quote(options.cwd)}`,
		...Object.entries(options.env).map(([key, value]) => `set "${key}=${text(value)}"`),
		[options.command, ...options.args].map(quote).join(" "),
		`echo %errorlevel%> ${quote(done)}`,
		"",
	].join("\r\n");
}

/** A .command script for Terminal, which runs it in a new window. Exported for tests. */
export function macScript(options: TerminalWindowOptions, done: string): string {
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	return [
		"#!/bin/bash",
		"clear",
		`echo ${quote(options.title)}`,
		`echo ${quote("Leuria opened this window. Follow the steps below, then close it.")}`,
		"echo",
		`cd ${quote(options.cwd)}`,
		...Object.entries(options.env).map(([key, value]) => `export ${key}=${quote(value)}`),
		[options.command, ...options.args].map(quote).join(" "),
		`echo $? > ${quote(done)}`,
		`echo; echo ${quote("Done. You can close this window.")}`,
		"",
	].join("\n");
}
