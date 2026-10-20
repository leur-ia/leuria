import { describe, expect, it } from "vitest";

import { Activity, HIDDEN_HOURLY_CAP, HOURLY_CAP } from "../src/activity.js";

describe("what a site asks, counted", () => {
	it("counts today and the last hour, and refuses past the caps", () => {
		const activity = new Activity(null);
		const now = Date.now();
		const site = "https://shop.example";
		for (let i = 0; i < HIDDEN_HOURLY_CAP; i++) activity.record(site, { at: now - i * 1000, ms: 2000, hidden: true });
		expect(activity.of(site, now)).toMatchObject({ today: { turns: HIDDEN_HOURLY_CAP, seconds: HIDDEN_HOURLY_CAP * 2 }, hour: HIDDEN_HOURLY_CAP, hiddenHour: HIDDEN_HOURLY_CAP, limited: false });
		// A background page is cut off first; a visible one may go on.
		expect(activity.refusal(site, true)).toMatch(/weren't looking/);
		expect(activity.refusal(site, false)).toBeUndefined();
		for (let i = activity.of(site, now).hour; i < HOURLY_CAP; i++) activity.record(site, { at: now, ms: 1000 });
		expect(activity.refusal(site)).toMatch(/limit/);
		expect(activity.of(site, now).limited).toBe(true);
		// An hour later, and yesterday's turns, count for nothing.
		expect(activity.of(site, now + 3_600_001)).toMatchObject({ hour: 0, limited: false });
		activity.forget(site);
		expect(activity.summary()).toEqual({});
	});
});
