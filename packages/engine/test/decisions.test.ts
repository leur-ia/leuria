import { afterEach, describe, expect, it, vi } from "vitest";

import { askSystemOne, DECISION, decisionBaseUrl, probeService, DecisionRefusedError, DEFAULT_DECISION_URL, listLocalDeciders, NoDecisionModelError, parseDecideBody, systemOneDecisions } from "../src/llm/decisions.js";

afterEach(() => vi.unstubAllGlobals());

describe("parseDecideBody", () => {
	const urgent = { type: "noul", instructions: "Is it urgent?" };

	it("keeps System One's own shape, with the model optional", () => {
		const body = { state: { text: "help" }, questions: { urgent, team: { type: "choice", instructions: "Which team?", criteria: { billing: "money", tech: "bugs" } } } };
		expect(parseDecideBody(body)).toEqual(body);
		expect(parseDecideBody({ ...body, model: "jev-1.13.0" }).model).toBe("jev-1.13.0");
	});

	it("rejects what the service would, before sending it", () => {
		expect(() => parseDecideBody({ questions: { urgent } })).toThrow(/state is required/);
		expect(() => parseDecideBody({ state: "x", questions: {} })).toThrow(/at least one/);
		expect(() => parseDecideBody({ state: "x", questions: { q: { type: "guess", instructions: "?" } } })).toThrow(/questions.q.type/);
		expect(() => parseDecideBody({ state: "x", questions: { q: { type: "choice", instructions: "?", criteria: { only: "one" } } } })).toThrow(/two options/);
		expect(() => parseDecideBody({ state: "x", questions: { q: { type: "score", instructions: "?", criteria: ["one"] } } })).toThrow(/2 to 10/);
		expect(() => parseDecideBody({ state: "x".repeat(100_001), questions: { urgent } })).toThrow(/over/);
	});
});

describe("askSystemOne", () => {
	const request = { state: "Help!", questions: { urgent: { type: "noul" as const, instructions: "Urgent?" } } };

	it("posts the request with the key and the default model", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Response.json({ model: "jev-1.13.0", answers: { urgent: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 5, output_tokens: 1 } });
		});
		const result = await askSystemOne({ baseUrl: DEFAULT_DECISION_URL, apiKey: "sk-test" }, request);
		expect(result).toEqual({ model: "jev-1.13.0", answers: { urgent: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 5, output_tokens: 1 } });
		expect(calls[0]?.url).toBe(`${DEFAULT_DECISION_URL}/systemone`);
		expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
		expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ ...request, model: "jev-latest" });
	});

	it("reaches a service at its own address, without a key", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Response.json({ model: "jev-local", answers: { urgent: { type: "noul", noul: 0.2 } } });
		});
		expect((await askSystemOne({ baseUrl: "http://localhost:8000/v1" }, request)).model).toBe("jev-local");
		expect(calls[0]?.url).toBe("http://localhost:8000/v1/systemone");
		expect(calls[0]?.init.headers).not.toHaveProperty("Authorization");
	});

	it("passes the service's refusal on, with its status", async () => {
		vi.stubGlobal("fetch", async () => Response.json({ error: { message: "Invalid API key" } }, { status: 401 }));
		const error = await askSystemOne({ baseUrl: DEFAULT_DECISION_URL, apiKey: "bad" }, request).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DecisionRefusedError);
		expect((error as DecisionRefusedError).status).toBe(401);
		expect((error as Error).message).toBe("Invalid API key");
	});
});

describe("probeService", () => {
	it("takes the address in any of its forms", () => {
		for (const typed of ["localhost:8000", "http://localhost:8000/", "http://localhost:8000/v1", "http://localhost:8000/v1/systemone", "http://localhost:8000/systemone"]) {
			expect(decisionBaseUrl(typed)).toBe("http://localhost:8000/v1");
		}
	});

	it("lists the service's models, decision ones first, and tries one", async () => {
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			if (url === "http://localhost:8000/v1/models") {
				if (!(init?.headers as Record<string, string>)?.Authorization) return Response.json({ error: { message: "API key required" } }, { status: 401 });
				return Response.json({ data: [{ id: "qwen3.5-9b-mlx" }, { id: "Tev1-4B-openjev" }] });
			}
			if (url === "http://localhost:8000/v1/systemone") {
				const body = JSON.parse(init?.body as string) as { model: string };
				return body.model === "Tev1-4B-openjev" ? Response.json({ model: body.model, answers: { works: { type: "noul", noul: 1 } } }) : Response.json({ error: "no such model" }, { status: 404 });
			}
			throw new Error("offline");
		});
		await expect(probeService({ baseUrl: "http://localhost:8000/v1" })).rejects.toThrow(/wants an API key/);
		const probe = await probeService({ baseUrl: "http://localhost:8000/v1", apiKey: "k" });
		expect(probe.models.map((m) => m.id)).toEqual(["Tev1-4B-openjev", "qwen3.5-9b-mlx"]);
		expect(probe.tried).toMatchObject({ model: "Tev1-4B-openjev", ok: true });
		expect((await probeService({ baseUrl: "http://localhost:8000/v1", apiKey: "k", model: "qwen3.5-9b-mlx" })).tried).toMatchObject({ ok: false, error: "no such model" });
	});
});

describe("systemOneDecisions", () => {
	const request = { state: "Help!", questions: { urgent: { type: "noul" as const, instructions: "Urgent?" } } };

	/** Ollama with a decision model and a chat model; LM Studio off. */
	function fakeOllama() {
		const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body as string) as Record<string, unknown> } : {}) });
			if (url === "http://127.0.0.1:11434/api/tags") return Response.json({ models: [{ name: "qwen3:8b" }, { name: "nimble:latest" }, { name: "tev1:0.8b", remote_host: "ollama.com" }] });
			if (url === "http://127.0.0.1:11434/v1/systemone") return Response.json({ model: "nimble:latest", answers: { urgent: { type: "noul", noul: 0.7 } } });
			throw new Error("offline");
		});
		return calls;
	}

	it("takes LM Studio's word for which models decide, loaded ones first", async () => {
		vi.stubGlobal("fetch", async (url: string) => {
			if (url === "http://127.0.0.1:1234/api/v1/models") {
				return Response.json({
					models: [
						{ key: "qwen3-8b", type: "llm", loaded_instances: [{ id: "a" }] },
						{ key: "bespoke/nimble-9b", type: "decision", loaded_instances: [] },
						{ key: "together/tev1-4b", type: "decision", decision_type: "jev", loaded_instances: [{ id: "b" }] },
					],
				});
			}
			throw new Error("offline");
		});
		expect((await listLocalDeciders()).map((d) => `${d.provider.id}:${d.model.id}:${d.model.loaded}`)).toEqual(["lmstudio:together/tev1-4b:true", "lmstudio:bespoke/nimble-9b:false"]);
		expect(await systemOneDecisions(() => undefined).find()).toMatchObject({ model: "together/tev1-4b", name: "LM Studio", local: true, baseUrl: "http://127.0.0.1:1234/v1" });
	});

	it("recognises Ollama's decision models by name", () => {
		expect(["nimble", "nimble:latest", "tev1:0.8b", "library/clef-flash", "Tev1-4B-openjev", "openjev-27b-mlx-4bit", "d3-flash", "lev"].every((m) => DECISION.test(m))).toBe(true);
		expect(["qwen3:8b", "nomic-embed-text", "nimbleton", "eleven-labs", "d30", "kevin-7b"].some((m) => DECISION.test(m))).toBe(false);
	});

	it("uses the first decision model on this computer, and keeps the visitor's pick over the page's", async () => {
		const calls = fakeOllama();
		expect((await listLocalDeciders()).map((d) => d.model.id)).toEqual(["nimble:latest"]);
		const auto = systemOneDecisions(() => undefined);
		expect(await auto.find()).toMatchObject({ model: "nimble:latest", name: "Ollama", local: true });
		const result = await auto.decide({ ...request, model: "jev-1.13.0" });
		expect(result.answers.urgent).toEqual({ type: "noul", noul: 0.7 });
		expect(calls.at(-1)?.body?.model).toBe("nimble:latest");
	});

	it("honours a chosen model only while it is there, and a service as it is", async () => {
		fakeOllama();
		expect(await systemOneDecisions(() => ({ provider: "ollama", model: "nimble:latest" })).find()).toMatchObject({ model: "nimble:latest" });
		expect(await systemOneDecisions(() => ({ provider: "ollama", model: "gone" })).find()).toBeUndefined();
		expect(await systemOneDecisions(() => ({ provider: "lmstudio", model: "nimble" })).find()).toBeUndefined();
		expect(await systemOneDecisions(() => "off").find()).toBeUndefined();
		expect(await systemOneDecisions(() => ({ baseUrl: DEFAULT_DECISION_URL, apiKey: "sk" })).find()).toMatchObject({ model: "jev-latest", name: "TypeSafe", local: false });
		expect(await systemOneDecisions(() => ({ baseUrl: "http://localhost:8000/v1", model: "Tev1-4B-openjev" })).find()).toMatchObject({ model: "Tev1-4B-openjev", local: true });
	});

	it("gives each site its own choice, cached apart", async () => {
		fakeOllama();
		const decisions = systemOneDecisions((origin) => (origin === "https://quiet.example" ? "off" : undefined));
		expect(await decisions.find("https://quiet.example")).toBeUndefined();
		expect(await decisions.find("https://other.example")).toMatchObject({ model: "nimble:latest" });
		expect(await decisions.find()).toMatchObject({ model: "nimble:latest" });
		await expect(decisions.decide(request, undefined, "https://quiet.example")).rejects.toBeInstanceOf(NoDecisionModelError);
	});

	it("has no model when nothing is found, and never calls a service out", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("offline");
		});
		const none = systemOneDecisions(() => undefined);
		expect(await none.find()).toBeUndefined();
		await expect(none.decide(request)).rejects.toBeInstanceOf(NoDecisionModelError);
	});
});
