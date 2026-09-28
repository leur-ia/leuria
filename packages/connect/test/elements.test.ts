import { BaseProvider, createLeuria, type Leuria, type ProviderSession, type ProviderState } from "@leuria/client";
import { afterEach, describe, expect, it } from "vitest";

import { type LeuriaConnectButton, setDefaultAppearance, setDefaultClient } from "../src/index.js";

class FakeProvider extends BaseProvider {
	allow = true;
	constructor(id: string, status: ProviderState["status"], model?: string) {
		super(id, `Provider ${id}`, "device", { status, capabilities: ["chat"], model });
	}
	set(patch: Partial<ProviderState>): void {
		this.setState(patch);
	}
	async detect(): Promise<void> {}
	async connect(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (!this.allow) throw new Error("The visitor did not allow this site.");
		this.setState({ status: "ready" });
	}
	disconnect(): void {
		this.setState({ status: "needs-action", action: "connect" });
	}
	async createSession(): Promise<ProviderSession> {
		return { send: async () => ({ text: "" }), close: () => undefined };
	}
}

let client: Leuria | undefined;
function use(...providers: BaseProvider[]): Leuria {
	client = createLeuria({ providers, autoDetect: false, closeOnUnload: false });
	return client;
}
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (el: Element) => el.shadowRoot!.querySelector(".root")!.textContent!.replace(/\s+/g, " ").trim();
const button = (el: Element) => el.shadowRoot!.querySelector<HTMLButtonElement>(".connect")!;

afterEach(() => {
	document.body.innerHTML = "";
	setDefaultClient(undefined);
	client?.destroy();
});

describe("<leuria-connect-button>", () => {
	it("looks for the AI until it has a client, then follows the default one", () => {
		const el = document.body.appendChild(document.createElement("leuria-connect-button"));
		expect(button(el).textContent).toBe("Looking for your AI…");
		setDefaultClient(use(new FakeProvider("bridge", "needs-action")));
		expect(button(el).textContent).toBe("Connect your AIby leuria");
	});

	it("connects: waiting for approval, then connected with the visitor's AI", async () => {
		const el = document.createElement("leuria-connect-button");
		el.client = use(new FakeProvider("bridge", "needs-action", "Codex"));
		document.body.append(el);
		button(el).click();
		expect(button(el).textContent).toBe("Waiting for your approval…");
		expect(button(el).getAttribute("aria-busy")).toBe("");
		await wait();
		expect(button(el).textContent).toBe("ConnectedCodex");
		expect(button(el).getAttribute("aria-haspopup")).toBe("menu");
	});

	it("says not connected when the visitor declines", async () => {
		const bridge = new FakeProvider("bridge", "needs-action");
		bridge.allow = false;
		const el = document.createElement("leuria-connect-button");
		el.client = use(bridge);
		document.body.append(el);
		button(el).click();
		await wait();
		expect(button(el).textContent).toBe("Not connectedTry again");
	});

	it("opens Leuria on the site's settings from the menu", () => {
		const bridge = new FakeProvider("bridge", "ready");
		let managed = 0;
		(bridge as unknown as { manage: () => void }).manage = () => void managed++;
		const el = document.createElement("leuria-connect-button");
		el.client = use(bridge);
		document.body.append(el);
		const item = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-action=manage]")!;
		expect(item.hidden).toBe(false);
		expect(item.textContent).toBe("Change AI or model…");
		item.click();
		expect(managed).toBe(1);
	});

	it("disconnects from the menu and tells the page", () => {
		const el = document.createElement("leuria-connect-button") as LeuriaConnectButton;
		el.client = use(new FakeProvider("bridge", "ready"));
		document.body.append(el);
		let told = 0;
		el.addEventListener("leuria-disconnect", () => told++);
		el.shadowRoot!.querySelector<HTMLButtonElement>("[data-action=disconnect]")!.click();
		expect(told).toBe(1);
		expect(button(el).textContent).toBe("Connect your AIby leuria");
	});

	it("explains how to get Leuria when a connect gets no answer, and offers to try again", async () => {
		const bridge = new FakeProvider("bridge", "needs-action");
		bridge.connect = async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			bridge.set({ status: "unavailable" });
			throw new Error("Leuria didn't answer");
		};
		const el = document.createElement("leuria-connect-button");
		el.client = use(bridge);
		document.body.append(el);
		button(el).click();
		await wait();
		const dialog = el.shadowRoot!.querySelector<HTMLDialogElement>(".dialog")!;
		expect(dialog.open).toBe(true);
		expect(text(el)).toContain("Download Leuria");
		expect(el.shadowRoot!.querySelector("[data-action=connect]")?.textContent).toBe("Try again");
	});

	it("offers the other AIs as secondary choices, for this page only", async () => {
		class OwnAI extends FakeProvider {
			readonly asksFirst = true;
		}
		const own = new OwnAI("bridge", "needs-action");
		own.connect = async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			own.set({ status: "unavailable" });
			throw new Error("Leuria didn't answer");
		};
		const ai = use(own, new FakeProvider("browser", "ready"));
		const el = document.createElement("leuria-connect-button");
		el.client = ai;
		document.body.append(el);
		expect(ai.getState().active).toBeUndefined();
		button(el).click();
		await wait();
		const choice = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-action=instead]")!;
		expect(choice.textContent).toBe("use this browser's AI");
		choice.click();
		expect(ai.getState().active?.id).toBe("browser");
		expect(el.shadowRoot!.querySelector<HTMLDialogElement>(".dialog")!.open).toBe(false);
	});

	it("honours size and hide-byline", () => {
		const el = document.createElement("leuria-connect-button");
		el.setAttribute("size", "3");
		el.setAttribute("hide-byline", "");
		el.client = use(new FakeProvider("bridge", "needs-action"));
		document.body.append(el);
		expect(button(el).className).toContain("s3");
		expect(button(el).textContent).toBe("Connect your AI");
	});

	it("has a compact size for navigation bars", () => {
		const el = document.createElement("leuria-connect-button");
		el.setAttribute("size", "1");
		el.client = use(new FakeProvider("bridge", "needs-action"));
		document.body.append(el);
		expect(button(el).className).toContain("s1");
	});

	it("follows the page's appearance, unless it has its own", () => {
		const follows = document.body.appendChild(document.createElement("leuria-connect-button"));
		const own = document.createElement("leuria-connect-button");
		own.setAttribute("appearance", "light");
		document.body.append(own);
		setDefaultAppearance("dark");
		expect(follows.getAttribute("appearance")).toBe("dark");
		expect(own.getAttribute("appearance")).toBe("light");
		const later = document.body.appendChild(document.createElement("leuria-ai-status"));
		expect(later.getAttribute("appearance")).toBe("dark");
		setDefaultAppearance(undefined);
		expect(follows.hasAttribute("appearance")).toBe(false);
		expect(own.getAttribute("appearance")).toBe("light");
	});

	it("shares the attempt with other UI on the page", async () => {
		const ai = use(new FakeProvider("bridge", "needs-action"));
		const a = document.createElement("leuria-connect-button");
		const b = document.createElement("leuria-connect-button");
		a.client = ai;
		b.client = ai;
		document.body.append(a, b);
		button(a).click();
		expect(button(b).textContent).toBe("Waiting for your approval…");
		await wait();
	});
});

describe("<leuria-ai-status>", () => {
	it("names the AI that answers", () => {
		const bridge = new FakeProvider("bridge", "unavailable", "Codex");
		const browser = new FakeProvider("browser", "ready");
		setDefaultClient(use(bridge, browser));
		const el = document.body.appendChild(document.createElement("leuria-ai-status"));
		expect(text(el)).toBe("This browser's AI");
		bridge.set({ status: "ready" });
		expect(text(el)).toBe("Your AI · Codex");
		el.labels = { bridge: "Votre IA" };
		expect(text(el)).toBe("Votre IA · Codex");
	});

	it("says when there is none", () => {
		setDefaultClient(use(new FakeProvider("bridge", "unavailable")));
		const el = document.body.appendChild(document.createElement("leuria-ai-status"));
		expect(text(el)).toBe("No AI yet");
	});
});

describe("<leuria-badge>", () => {
	it("links to Leuria", () => {
		const el = document.body.appendChild(document.createElement("leuria-badge"));
		expect(el.shadowRoot!.querySelector("a")!.href).toBe("https://leuria.eu/");
		el.setAttribute("href", "https://example.com/leuria");
		expect(el.shadowRoot!.querySelector("a")!.href).toBe("https://example.com/leuria");
	});
});
