import { describe, expect, it } from "vitest";

import { parseConnectLink, parseSiteLink } from "../src/connect-link";

describe("parseConnectLink", () => {
	it("reads a site's link", () => {
		const origin = encodeURIComponent("https://shop.example");
		expect(parseConnectLink(`leuria://connect?origin=${origin}&app=Kiln%20%26%20Co.&nonce=abc123def456ghi789jkl0`)).toEqual({
			origin: "https://shop.example",
			app: "Kiln & Co.",
			nonce: "abc123def456ghi789jkl0",
		});
		expect(parseConnectLink("leuria://connect/?origin=https://a.example&nonce=n")).toMatchObject({ origin: "https://a.example" });
	});

	it("ignores anything else", () => {
		expect(parseConnectLink("https://shop.example/connect?origin=x&nonce=y")).toBeNull();
		expect(parseConnectLink("leuria://settings?origin=x&nonce=y")).toBeNull();
		expect(parseConnectLink("leuria://connect?origin=https://a.example")).toBeNull();
		expect(parseConnectLink("not a url")).toBeNull();
	});
});

describe("what a site says it needs, and its settings link", () => {
	it("reads the needs from the connect link", () => {
		expect(parseConnectLink("leuria://connect?origin=https://a.example&nonce=n&tools=1&effort=light&context=8000&effort2=x")).toMatchObject({
			needs: { tools: true, effort: "light", context: 8000 },
		});
		expect(parseConnectLink("leuria://connect?origin=https://a.example&nonce=n&effort=huge")).not.toHaveProperty("needs");
	});

	it("reads a site's settings link", () => {
		expect(parseSiteLink(`leuria://site?origin=${encodeURIComponent("https://shop.example")}`)).toEqual({ origin: "https://shop.example" });
		expect(parseSiteLink("leuria://connect?origin=https://shop.example")).toBeNull();
	});
});
