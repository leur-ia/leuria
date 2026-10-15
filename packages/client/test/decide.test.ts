import { describe, expect, it } from "vitest";

import { BaseProvider, choice, createAI, type DecideRequest, type DecideResult, NoProviderError, noul, type ProviderSession, type ProviderState, score } from "../src/index.js";

/** Answers every question with its first option, level 0, or 1. */
class FakeDecider extends BaseProvider {
	readonly offers = ["decide"] as const;
	calls: DecideRequest[] = [];
	constructor(id: string, status: ProviderState["status"]) {
		super(id, `Decider ${id}`, "device", { status, capabilities: status === "ready" ? ["decide"] : [], decideModel: status === "ready" ? "jev-latest" : undefined });
	}
	async detect(): Promise<void> {}
	async decide(request: DecideRequest): Promise<DecideResult> {
		this.calls.push(request);
		const answers = Object.fromEntries(
			Object.entries(request.questions).map(([id, q]) => {
				if (q.type === "noul") return [id, { type: "noul", noul: 1 }];
				if (q.type === "choice") {
					const first = Object.keys(q.criteria)[0]!;
					return [id, { type: "choice", choice: first, probabilities: { [first]: 1 }, confidence: 1 }];
				}
				return [id, { type: "score", score: 0, legend: { "0": String(q.criteria[0]) }, probabilities: { "0": 1 }, confidence: 1 }];
			}),
		);
		return { model: "jev-1.13.0", answers };
	}
	async createSession(): Promise<ProviderSession> {
		throw new Error("cannot chat");
	}
}

const quiet = { autoDetect: false, closeOnUnload: false } as const;

describe("decide", () => {
	it("uses the first ready decider and types the answers by question", async () => {
		const engine = new FakeDecider("engine", "ready");
		const ai = createAI({ providers: [new FakeDecider("off", "unavailable"), engine], ...quiet });
		const { answers, model, provider } = await ai.decide(
			{ ticket: "My flight was cancelled. Refund?" },
			{
				refund: noul("Does `ticket` ask for a refund?"),
				kind: choice("What is asked in `ticket`?", { refund: "money back", rebooking: "another flight" }),
				anger: score("How angry is `ticket`?", ["calm", "upset", "furious"]),
			},
			{ model: "jev-1.13.0" },
		);
		expect(model).toBe("jev-1.13.0");
		expect(provider.id).toBe("engine");
		expect(answers.refund.noul).toBe(1);
		const kind: "refund" | "rebooking" = answers.kind.choice;
		expect(kind).toBe("refund");
		expect(answers.anger.score).toBe(0);
		expect(engine.calls[0]?.model).toBe("jev-1.13.0");
	});

	it("says why nothing can decide, and keeps deciders out of chat", async () => {
		const ai = createAI({ providers: [new FakeDecider("engine", "needs-action")], ...quiet });
		const error = await ai.decide("x", { q: noul("?") }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NoProviderError);
		expect((error as NoProviderError).reasons.map((r) => r.id)).toEqual(["engine"]);
		expect(ai.getState().active).toBeUndefined();
		expect(ai.getState().decider).toBeUndefined();
		expect(ai.getState().decidePending?.id).toBe("engine");
	});
});
