import { BaseProvider, createLeuria, type Leuria, type ProviderSession, type ProviderState } from "@leuria/client";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { LeuriaProvider, useChat, useConnect, useConversation, useLeuriaState } from "../src/index.js";

/** Answers every turn with `reply`; connects when `allow` says so. */
class FakeProvider extends BaseProvider {
	allow = true;
	closed = 0;
	constructor(id: string, status: ProviderState["status"], private readonly reply = "Hello") {
		super(id, `Provider ${id}`, "device", { status, capabilities: ["chat", "tools"] });
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
		return {
			send: async (_message, context) => {
				context.text(this.reply);
				return { text: this.reply };
			},
			close: () => {
				this.closed++;
			},
		};
	}
}

let client: Leuria;
function setup(...providers: BaseProvider[]) {
	client = createLeuria({ providers, autoDetect: false, closeOnUnload: false });
	return ({ children }: { children: ReactNode }) => <LeuriaProvider client={client}>{children}</LeuriaProvider>;
}

afterEach(() => {
	cleanup();
	client?.destroy();
});

describe("useLeuriaState", () => {
	it("follows provider changes", () => {
		const bridge = new FakeProvider("bridge", "unavailable");
		const { result } = renderHook(() => useLeuriaState((s) => s.active?.id), { wrapper: setup(bridge) });
		expect(result.current).toBeUndefined();
		act(() => bridge.set({ status: "ready" }));
		expect(result.current).toBe("bridge");
	});

	it("needs a provider above it", () => {
		expect(() => renderHook(() => useLeuriaState())).toThrow(/LeuriaProvider/);
	});
});

describe("useConnect", () => {
	it("goes from not connected to connected through connecting", async () => {
		const bridge = new FakeProvider("bridge", "needs-action");
		const { result } = renderHook(() => useConnect(), { wrapper: setup(bridge) });
		expect(result.current.status).toBe("not-connected");
		act(() => result.current.connect());
		expect(result.current.status).toBe("connecting");
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(result.current.status).toBe("connected");
		act(() => result.current.disconnect());
		expect(result.current.status).toBe("not-connected");
	});

	it("says declined when the visitor says no, and clears it on retry", async () => {
		const bridge = new FakeProvider("bridge", "needs-action");
		bridge.allow = false;
		const { result } = renderHook(() => useConnect(), { wrapper: setup(bridge) });
		act(() => result.current.connect());
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(result.current.status).toBe("declined");
		expect(result.current.error?.message).toMatch(/did not allow/);
		await act(() => result.current.retry());
		expect(result.current.status).toBe("not-connected");
	});

	it("shares the attempt between components", () => {
		const bridge = new FakeProvider("bridge", "needs-action");
		const wrapper = setup(bridge);
		const a = renderHook(() => useConnect(), { wrapper });
		const b = renderHook(() => useConnect(), { wrapper });
		act(() => a.result.current.connect());
		expect(b.result.current.status).toBe("connecting");
	});

	it("reports Leuria not running", () => {
		const { result } = renderHook(() => useConnect(), { wrapper: setup(new FakeProvider("bridge", "unavailable")) });
		expect(result.current.status).toBe("not-running");
	});
});

describe("useConversation", () => {
	it("sends, streams into messages and closes on unmount", async () => {
		const bridge = new FakeProvider("bridge", "ready", "Blue is 12 euros");
		const { result, unmount } = renderHook(() => useConversation({ system: "Shop" }), { wrapper: setup(bridge) });
		await act(() => result.current.send("How much is the blue mug?").text());
		expect(result.current.status).toBe("idle");
		expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(result.current.messages[1]?.parts[0]).toEqual({ type: "text", text: "Blue is 12 euros" });
		unmount();
		expect(bridge.closed).toBe(1);
	});

	it("keeps the same conversation across renders", () => {
		const { result, rerender } = renderHook(() => useConversation(), { wrapper: setup(new FakeProvider("bridge", "ready")) });
		const first = result.current.conversation;
		rerender();
		expect(result.current.conversation).toBe(first);
	});
});

describe("useChat", () => {
	it("streams a one-shot answer", async () => {
		const { result } = renderHook(() => useChat(), { wrapper: setup(new FakeProvider("bridge", "ready", "Done")) });
		await act(() => result.current.start({ prompt: "Hi" }).text());
		expect(result.current).toMatchObject({ status: "done", text: "Done", provider: { id: "bridge" } });
	});

	it("reports a failure without throwing", async () => {
		const { result } = renderHook(() => useChat(), { wrapper: setup(new FakeProvider("bridge", "unavailable")) });
		await act(() => result.current.start({ prompt: "Hi" }).text().catch(() => undefined));
		expect(result.current.status).toBe("error");
		expect(result.current.error?.name).toBe("NoProviderError");
	});
});

it("renders inside a component", () => {
	function Status() {
		const { status } = useConnect();
		return <p>{status}</p>;
	}
	const wrapper = setup(new FakeProvider("bridge", "ready"));
	const { container } = render(<Status />, { wrapper });
	expect(container.textContent).toBe("connected");
});
