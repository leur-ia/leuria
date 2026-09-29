import { describe, expect, it } from "vitest";

import { insteadLabel, limitedHere } from "../src/connect-button.js";

const browser = { id: "browser", locality: "device", label: "Browser AI", status: "ready", capabilities: ["chat", "structured"] };

describe("naming another AI", () => {
	it("says when it answers with less on this page", () => {
		expect(limitedHere(browser, ["tools"])).toBe(true);
		expect(limitedHere(browser, [])).toBe(false);
		expect(insteadLabel(browser)).toBe("use this browser's AI");
		expect(insteadLabel(browser, ["tools"])).toBe("use this browser's AI (simpler answers here)");
		expect(insteadLabel({ ...browser, status: "needs-action", action: "download" }, ["tools"])).toBe(
			"use this browser's AI (a one-time download, simpler answers here)",
		);
		expect(insteadLabel({ id: "server", locality: "site", label: "Server", status: "ready", capabilities: ["chat", "tools"] }, ["tools"])).toBe(
			"use this site's AI",
		);
	});
});
