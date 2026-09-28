import type { Locality, Provider, ProviderSession, ProviderState, SessionOptions } from "../types.js";

/**
 * State and change notification for providers. Subclasses implement
 * `detect` and `createSession`, and call `setState`.
 */
export abstract class BaseProvider implements Provider {
	private state: ProviderState;
	private readonly listeners = new Set<() => void>();

	protected constructor(
		readonly id: string,
		readonly label: string,
		readonly locality: Locality,
		initial: ProviderState,
	) {
		this.state = initial;
	}

	getState = (): ProviderState => this.state;

	onChange = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	abstract detect(): Promise<void>;
	abstract createSession(options: SessionOptions): Promise<ProviderSession>;

	protected setState(patch: Partial<ProviderState>): void {
		const next = { ...this.state, ...patch };
		if (JSON.stringify(next) === JSON.stringify(this.state)) return;
		this.state = next;
		for (const listener of this.listeners) listener();
	}
}
