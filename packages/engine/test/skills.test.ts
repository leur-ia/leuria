import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GrantStore } from "../src/grants.js";
import { type EngineHandle, startEngine } from "../src/server.js";
import { fetchSkills, parseSkillMd, parseSkillSource } from "../src/skill-sources.js";
import { parseSkillRefs, readSkill, SkillService, skillsPrompt } from "../src/skills.js";
import { WebMcpServer } from "../src/webmcp-server.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const SITE = "https://shop.example";

const skillMd = (name: string, description: string, body = `Do ${name}.`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

describe("skill sources", () => {
	it("reads the npx skills syntax", () => {
		expect(parseSkillSource("vercel-labs/agent-skills", SITE)).toEqual({ kind: "github", repo: "vercel-labs/agent-skills" });
		expect(parseSkillSource("vercel-labs/agent-skills@web-design", SITE)).toEqual({ kind: "github", repo: "vercel-labs/agent-skills", skill: "web-design" });
		expect(parseSkillSource("owner/repo/skills/returns#v1.2", SITE)).toEqual({ kind: "github", repo: "owner/repo", ref: "v1.2", subpath: "skills/returns" });
		expect(parseSkillSource("github:owner/repo#abc123@one", SITE)).toEqual({ kind: "github", repo: "owner/repo", ref: "abc123", skill: "one" });
		expect(parseSkillSource("https://github.com/owner/repo/tree/main/skills/pdf", SITE)).toEqual({ kind: "github", repo: "owner/repo", ref: "main", subpath: "skills/pdf" });
	});

	it("takes the site's own URLs, relative or absolute", () => {
		expect(parseSkillSource("/", SITE)).toEqual({ kind: "site", url: "https://shop.example/" });
		expect(parseSkillSource("https://shop.example/help/SKILL.md", SITE)).toEqual({ kind: "site", url: "https://shop.example/help/SKILL.md" });
	});

	it("refuses any other address", () => {
		expect(() => parseSkillSource("https://192.168.1.1/SKILL.md", SITE)).toThrow(/own origin/);
		expect(() => parseSkillSource("http://127.0.0.1:8080/", SITE)).toThrow(/own origin/);
		expect(() => parseSkillSource("owner/../x", SITE)).toThrow();
		expect(() => parseSkillSource("justone", SITE)).toThrow();
	});

	it("parses SKILL.md front matter", () => {
		const skill = parseSkillMd(skillMd("returns", "How to prepare a return.", "Step 1."));
		expect(skill).toMatchObject({ name: "returns", description: "How to prepare a return.", body: "Step 1." });
		expect(() => parseSkillMd("no front matter")).toThrow();
		expect(() => parseSkillMd(skillMd("Bad Name", "x"))).toThrow(/skill name/);
	});

	it("checks what a site declares", () => {
		expect(parseSkillRefs(["a/b", " a/b ", 3, "", "c/d"])).toEqual(["a/b", "c/d"]);
		expect(parseSkillRefs([])).toBeUndefined();
		expect(parseSkillRefs("a/b")).toEqual(["a/b"]);
	});
});

describe("skills from the site's own origin", () => {
	let server: http.Server;
	let origin: string;
	const files: Record<string, string> = {};

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			const body = files[req.url ?? ""];
			res.writeHead(body === undefined ? 404 : 200).end(body ?? "");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		const returns = skillMd("returns", "How to prepare a return request.");
		const sizes = skillMd("size-guide", "Pick sizes from measurements.");
		const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
		files["/.well-known/agent-skills/index.json"] = JSON.stringify({
			$schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
			skills: [
				{ name: "returns", type: "skill-md", description: "x", url: "/.well-known/agent-skills/returns/SKILL.md", digest: digest(returns) },
				{ name: "size-guide", type: "skill-md", description: "x", url: "/.well-known/agent-skills/size-guide/SKILL.md", digest: digest("something else") },
			],
		});
		files["/.well-known/agent-skills/returns/SKILL.md"] = returns;
		files["/.well-known/agent-skills/size-guide/SKILL.md"] = sizes;
		files["/v1/.well-known/skills/index.json"] = JSON.stringify({ skills: [{ name: "returns", description: "x", files: ["SKILL.md", "policy.md", "run.sh"] }] });
		files["/v1/.well-known/skills/returns/SKILL.md"] = returns;
		files["/v1/.well-known/skills/returns/policy.md"] = "30 days.";
		files["/v1/.well-known/skills/returns/run.sh"] = "rm -rf /";
		files["/help/SKILL.md"] = skillMd("help", "Answer questions about the shop.");
	});
	afterAll(() => server.close());

	it("discovers them at .well-known/agent-skills and checks each digest", async () => {
		const skills = await fetchSkills(parseSkillSource("/", origin));
		// size-guide doesn't match its digest: dropped.
		expect(skills.map((s) => s.name)).toEqual(["returns"]);
	});

	it("reads v0.1 indexes, keeping only text files", async () => {
		const [skill] = await fetchSkills(parseSkillSource("/v1/", origin));
		expect(skill?.files).toEqual({ "policy.md": "30 days." });
	});

	it("reads a SKILL.md URL", async () => {
		const [skill] = await fetchSkills(parseSkillSource("/help/SKILL.md", origin));
		expect(skill?.name).toBe("help");
	});
});

describe("SkillService", () => {
	let cache: string;
	beforeAll(() => {
		cache = mkdtempSync(join(tmpdir(), "leuria-skills-test-"));
	});
	afterAll(() => rmSync(cache, { recursive: true, force: true }));

	const fake = async (ref: string) => ({
		skills: ref === "broken/repo" ? [] : [parseSkillMd(skillMd(ref.split("/")[1]!, `The ${ref} skill.`))],
		source: ref,
		shared: true,
	});

	it("stores skills once, by content, and gives a site only its own", async () => {
		const grants = new GrantStore(null);
		const service = new SkillService({ grants, logger: silent, cache, fetch: fake });
		const a = await service.resolve(SITE, ["o/returns", "o/sizes"]);
		const b = await service.resolve("https://other.example", ["o/returns"]);
		expect(b[0]?.integrity).toBe(a[0]?.integrity);
		grants.create(SITE, "Shop", undefined, { refs: ["o/returns", "o/sizes"], list: a });
		grants.create("https://other.example", "Other", undefined, { refs: ["o/returns"], list: b });
		expect((await service.forSession(SITE)).map((s) => s.name)).toEqual(["returns", "sizes"]);
		expect((await service.forSession("https://other.example")).map((s) => s.name)).toEqual(["returns"]);
		expect(await service.forSession("https://unknown.example")).toEqual([]);
	});

	it("marks skills a connected site adds", async () => {
		const grants = new GrantStore(null);
		const service = new SkillService({ grants, logger: silent, cache: null, fetch: fake });
		grants.create(SITE, "Shop", undefined, { refs: ["o/returns"], list: await service.resolve(SITE, ["o/returns"]) });
		service.refresh(SITE, ["o/returns", "o/sizes"]);
		await service.settled();
		const list = grants.get(SITE)?.skills?.list ?? [];
		expect(list.map((s) => [s.name, Boolean(s.addedAt)])).toEqual([["returns", false], ["sizes", true]]);
		service.refresh(SITE, undefined);
		await service.settled();
		expect(grants.get(SITE)?.skills).toBeUndefined();
	});

	it("tells the agent the skills and serves read_skill", () => {
		const skill = { ...parseSkillMd(skillMd("returns", "How to prepare a return.", "Ask for the order number.")), files: { "policy.md": "30 days." } };
		expect(skillsPrompt([skill])).toContain("- returns: How to prepare a return.");
		expect(readSkill([skill], { name: "returns" })).toContain("Ask for the order number.");
		expect(readSkill([skill], { name: "returns", file: "policy.md" })).toBe("30 days.");
		expect(() => readSkill([skill], { name: "nope" })).toThrow(/No skill/);
	});

	it("adds read_skill to the session's tools, and only there", async () => {
		const webmcp = new WebMcpServer(silent, 0);
		webmcp.createChannel("with");
		webmcp.createChannel("without");
		webmcp.setSkills("with", [parseSkillMd(skillMd("returns", "How to prepare a return."))]);
		expect(webmcp.listTools("with").map((t) => t.name)).toEqual(["read_skill"]);
		expect(webmcp.listTools("without")).toEqual([]);
		expect(await webmcp.callTool("with", "read_skill", { name: "returns" })).toContain("Do returns.");
		await expect(webmcp.callTool("without", "read_skill", { name: "returns" })).rejects.toThrow(/Unknown tool/);
		webmcp.close();
	});
});

describe("skills in pairing", () => {
	const PORT = 19598;
	let engine: EngineHandle;
	let grants: GrantStore;
	let release: () => void = () => {};

	beforeAll(async () => {
		grants = new GrantStore(null);
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const service = new SkillService({
			grants,
			logger: silent,
			cache: null,
			fetch: async () => {
				// Fetching takes a while: the request is shown first, loading.
				await gate;
				return { skills: [parseSkillMd(skillMd("returns", "How to prepare a return."))], source: "shop.example", shared: false };
			},
		});
		engine = await startEngine({ port: PORT, grants, logger: silent, agentName: "Test agent", skills: service, resolveAgent: async () => ({ command: "none", args: [] }) });
	});
	afterAll(() => engine.close());

	it("shows the site's skills before the visitor answers, and keeps them with the grant", async () => {
		const claim = fetch(`http://127.0.0.1:${PORT}/connect/claim`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: SITE },
			body: JSON.stringify({ nonce: randomBytes(24).toString("base64url"), app: "Shop", skills: ["/"] }),
		});
		let pending = engine.pairing.pending()[0];
		for (let i = 0; i < 100 && !pending; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			pending = engine.pairing.pending()[0];
		}
		expect(pending?.skills).toEqual({ loading: true, list: [] });
		const page = await (await fetch(`http://127.0.0.1:${PORT}/connect/${pending!.requestId}`)).text();
		expect(page).toContain("Checking the skills");

		release();
		for (let i = 0; i < 100 && engine.pairing.pending()[0]?.skills?.loading; i++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect(engine.pairing.pending()[0]?.skills).toEqual({
			loading: false,
			list: [{ name: "returns", description: "How to prepare a return.", source: "shop.example", shared: false }],
		});
		const ready = await (await fetch(`http://127.0.0.1:${PORT}/connect/${pending!.requestId}`)).text();
		expect(ready).toContain("This site uses 1 skill to guide your AI.");
		expect(ready).toContain("See details");

		engine.pairing.decideById(pending!.requestId, true);
		expect(((await (await claim).json()) as { status: string }).status).toBe("allowed");
		expect(grants.get(SITE)?.skills?.list.map((s) => s.name)).toEqual(["returns"]);
	});
});
