import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { catchBrowserLinks } from "../src/browser-link.js";

describe("the sign-in page link", () => {
	it.skipIf(process.platform === "win32")("is noted when the agent opens it, and still passed to the real command", async () => {
		const urls: string[] = [];
		// `true` stands in for the real `open`: nothing opens during tests.
		const link = catchBrowserLinks((url) => urls.push(url), { real: () => "/usr/bin/true" })!;
		try {
			execFileSync("open", ["https://auth.example.com/login?x=1"], { env: { ...process.env, ...link.env } });
			execFileSync("xdg-open", ["not-a-link"], { env: { ...process.env, ...link.env } });
			await new Promise((r) => setTimeout(r, 700));
			expect(urls).toEqual(["https://auth.example.com/login?x=1"]);
		} finally {
			link.stop();
		}
	});
});
