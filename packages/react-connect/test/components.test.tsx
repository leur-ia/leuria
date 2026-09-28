import { BaseProvider, createLeuria, type Leuria, type ProviderSession, type ProviderState } from "@leuria/client";
import { LeuriaProvider } from "@leuria/react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { AIStatus, ConnectButton, LeuriaBadge } from "../src/index.js";

class FakeProvider extends BaseProvider {
	constructor(id: string, status: ProviderState["status"], model?: string) {
		super(id, `Provider ${id}`, "device", { status, capabilities: ["chat"], model });
	}
	async detect(): Promise<void> {}
	disconnect(): void {
		this.setState({ status: "needs-action" });
	}
	async createSession(): Promise<ProviderSession> {
		return { send: async () => ({ text: "" }), close: () => undefined };
	}
}

let client: Leuria;
function mount(ui: React.ReactNode, status: ProviderState["status"] = "ready") {
	client = createLeuria({ providers: [new FakeProvider("bridge", status, "Codex")], autoDetect: false, closeOnUnload: false });
	return render(<LeuriaProvider client={client}>{ui}</LeuriaProvider>);
}
const shadowText = (el: Element | null) => el!.shadowRoot!.querySelector(".root")!.textContent!.replace(/\s+/g, " ").trim();

afterEach(() => {
	cleanup();
	client.destroy();
});

it("gives the button the provider's client and its attributes", () => {
	const { container } = mount(<ConnectButton size={3} byline={false} className="here" />, "needs-action");
	const el = container.querySelector("leuria-connect-button")!;
	expect(el.getAttribute("size")).toBe("3");
	expect(el.hasAttribute("hide-byline")).toBe(true);
	expect(el.className).toBe("here");
	expect(el.shadowRoot!.querySelector(".connect")!.textContent).toBe("Connect your AI");
});

it("calls onDisconnect", () => {
	let told = 0;
	const { container } = mount(<ConnectButton onDisconnect={() => told++} />);
	const el = container.querySelector("leuria-connect-button")!;
	act(() => el.shadowRoot!.querySelector<HTMLButtonElement>("[data-action=disconnect]")!.click());
	expect(told).toBe(1);
});

it("passes labels to the status", () => {
	const { container } = mount(<AIStatus labels={{ bridge: "Votre IA" }} />);
	expect(shadowText(container.querySelector("leuria-ai-status"))).toBe("Votre IA · Codex");
});

it("puts the badge's text in its slot", () => {
	const { container } = mount(<LeuriaBadge href="https://example.com">AI by you</LeuriaBadge>);
	const el = container.querySelector("leuria-badge")!;
	expect(el.textContent).toBe("AI by you");
	expect(el.getAttribute("href")).toBe("https://example.com");
});
