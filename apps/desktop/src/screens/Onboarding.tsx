import { BridgeStatus, Icon, InkButton, Logo, PearlSurface } from "@leuria/pearl";
import { Button, Callout, Card, Flex, Heading, Link, RadioCards, Select, Spinner, Text, TextField } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@sinuxjs/react";
import { useEffect, useState } from "react";

import { AgentModelSelect } from "../components/AgentModelSelect";
import { Disclosure } from "../components/Disclosure";
import { activityText, trayName, type AgentChoice, describeAgent, plainReason, signInLabel, describeCheck, friendlyName } from "../engine";
import { appStore } from "../stores/app.store";
import { type AiKind, onboardingStore, SERVICES, SUGGESTED } from "../stores/onboarding.store";

/** The onboarding ladder, shown from the first step (Goal-Gradient Effect). */
function Steps({ current }: { current: 1 | 2 | 3 }) {
	return (
		<Flex direction="column" gap="2">
			<span className="pearl-eyebrow">Step {current} of 3</span>
			<div className="steps" aria-hidden>
				{[1, 2, 3].map((n) => (
					<span key={n} className={n <= current ? "done" : undefined} />
				))}
			</div>
		</Flex>
	);
}

/** API keys are for developers: offer the account sign-in first. */
function isApiKey(method: { id: string; name: string }): boolean {
	return /api.?key/i.test(`${method.id} ${method.name}`);
}

export function Onboarding() {
	const { agents, selected, showAll, step, progress, error, models, mode, signinUrl } = useStore(onboardingStore);
	// Leaving the flow: back to Leuria, ready for the next first-run setup.
	const finish = () => void onboardingStore.startSetup().then(() => appStore.refresh());

	useEffect(() => {
		if (!agents) void onboardingStore.load();
	}, [agents]);

	return (
		<div className="onboarding">
			<PearlSurface radius={0} padding="16px 24px 24px">
				<Logo size={22} />
				{step.kind === "choose" && (
					<Choose agents={agents} selected={selected} showAll={showAll} busy={false} error={error} progress={progress} />
				)}
				{step.kind === "installing" && (
					<Choose agents={agents} selected={step.agent.id} showAll={showAll} busy error="" progress={progress} />
				)}
				{step.kind === "signin" && (
					<Card variant="surface" size="3">
						<Flex direction="column" gap="4">
							<Steps current={2} />
							<Heading size="6">Sign in to {friendlyName(step.agent)}</Heading>
							<Text size="3" color="gray">
								{step.status.window
									? `Leuria uses your own account. A window opens with ${friendlyName(step.agent)}'s own sign-in, then your browser.`
									: "Leuria uses your own account. Your browser opens to sign in."}
							</Text>
							{progress === "window" && (
								<Callout.Root color="blue">
									<Callout.Icon>
										<Icon name="info" />
									</Callout.Icon>
									<Callout.Text>
										A window opened to sign in to {friendlyName(step.agent)}. Follow the steps there, then come back: this window moves on by
										itself.
									</Callout.Text>
								</Callout.Root>
							)}
							{progress && progress !== "window" && (
								<Callout.Root color="blue">
									<Callout.Icon>
										<Icon name="info" />
									</Callout.Icon>
									<Callout.Text>
										A {friendlyName(step.agent).split(" (")[0]} page opened in your browser. Finish signing in there: this window moves on by itself.
										{signinUrl && (
											<>
												{" "}
												Didn't see it?{" "}
												<Link asChild>
													<button type="button" className="text-link" onClick={() => void invoke("open_link", { url: signinUrl })}>
														Open the sign-in page
													</button>
												</Link>
											</>
										)}
									</Callout.Text>
								</Callout.Root>
							)}
							{error && <Problem>{error}</Problem>}
							{step.status.window && (
								<InkButton loading={Boolean(progress)} onClick={() => void onboardingStore.signIn(step.agent)}>
									Sign in to {friendlyName(step.agent)}
								</InkButton>
							)}
							{step.status.methods.length === 0 && !step.status.window && (
								<Problem>{plainReason(step.status.detail) ?? `${friendlyName(step.agent)} can't be signed in from Leuria. Pick another AI.`}</Problem>
							)}
							{[...step.status.methods]
								.sort((a, b) => Number(isApiKey(a)) - Number(isApiKey(b)))
								.map((method, index) =>
									index === 0 && !step.status.window ? (
										<InkButton key={method.id} loading={Boolean(progress)} onClick={() => void onboardingStore.signIn(step.agent, method.id)}>
											{signInLabel(method)}
										</InkButton>
									) : progress ? null : (
										<Button key={method.id} variant="ghost" onClick={() => void onboardingStore.signIn(step.agent, method.id)}>
											Use {method.name} instead
										</Button>
									),
								)}
							{progress ? (
								<Button variant="ghost" color="gray" onClick={() => void onboardingStore.cancelSignIn()}>
									Cancel
								</Button>
							) : (
								<Button variant="ghost" color="gray" onClick={() => void onboardingStore.startOver(step.agent)}>
									Choose another AI
								</Button>
							)}
						</Flex>
					</Card>
				)}
				{step.kind === "checking" && (
					<Card variant="surface" size="3">
						<Flex direction="column" gap="4">
							<Steps current={3} />
							<Heading size="6">Checking that everything works</Heading>
							<Flex gap="3" align="center">
								<Spinner size="2" />
								<Text size="2" color="gray">
									{activityText(progress || "check-1", friendlyName(step.agent))}
								</Text>
							</Flex>
						</Flex>
					</Card>
				)}
				{step.kind === "done" && (
					<Card variant="surface" size="3">
						<Flex direction="column" gap="4">
							{step.result.ok ? (
								<>
									<BridgeStatus state="connected">
										{mode === "add" ? "Ready" : "Connected"} · {friendlyName(step.agent)}, on this computer
									</BridgeStatus>
									<Heading size="6">{mode === "add" ? `${friendlyName(step.agent)} is ready` : "You're all set"}</Heading>
									<Text size="3" color="gray">
										{mode === "add"
											? "Choose it for a website in Leuria, or make it your default."
											: `When a website offers to connect your AI, Leuria asks you first. You can close this window: Leuria stays in the ${trayName}.`}
									</Text>
									{models && models.options.length > 1 && (
										<Disclosure label="Model" value={models.options.find((m) => m.id === models.current)?.name}>
											<AgentModelSelect models={models} onChange={(id) => void onboardingStore.setModel(step.agent.id, id)} />
										</Disclosure>
									)}
									<InkButton onClick={finish}>Finish</InkButton>
								</>
							) : (
								<>
									<Steps current={3} />
									<Heading size="6">Something isn't right yet</Heading>
									<ul className="can-list">
										{step.result.steps.map((s, i) => (
											<li key={s.name} style={{ color: s.ok ? "var(--live-text)" : "var(--blocked-text)" }}>
												<Icon name={s.ok ? "check" : "x"} />
												{describeCheck(i, s.ok)}
											</li>
										))}
									</ul>
									<InkButton onClick={() => void onboardingStore.retryCheck(step.agent)}>Try again</InkButton>
									<Button variant="ghost" color="gray" onClick={() => void onboardingStore.startOver(step.agent)}>
										Choose another AI
									</Button>
								</>
							)}
						</Flex>
					</Card>
				)}
			</PearlSurface>
		</div>
	);
}

function Choose({
	agents,
	selected,
	showAll,
	busy,
	error,
	progress,
}: {
	agents: AgentChoice[] | null;
	selected: string | null;
	showAll: boolean;
	busy: boolean;
	error: string;
	progress: string;
}) {
	const { localModel, apiModel, api, apiFormOpen, query, adding, kind } = useStore(onboardingStore, (s) => ({
		adding: s.mode === "add",
		kind: s.kind,
		query: s.query,
		localModel: s.localModel,
		apiModel: s.apiModel,
		api: s.api,
		apiFormOpen: s.apiFormOpen,
	}));
	// Offer to keep the current AI only when it works.
	// Adding one more AI leaves the default alone: no "Keep" and no notice about it.
	const { current, broken, problem } = useStore(appStore, (s) => ({
		current: !adding && s.status?.agent.installed && !s.agentProblem ? s.status.agent : null,
		broken: !adding && s.status?.agent.installed && s.agentProblem ? s.status.agent : null,
		problem: s.agentProblem,
	}));

	const all = agents ?? [];
	// Adding: one kind at a time (an app, a model on this computer, a service with a key).
	const onlyApps = adding && kind === "app";
	const onlyLocal = adding && kind === "local";
	const onlyService = adding && kind === "service";
	const agentChoices = all.filter((a) => a.kind === "agent");
	const localModels = all.filter((a) => a.kind === "llm" && a.local);
	const apiModels = all.filter((a) => a.kind === "llm" && !a.local);
	// Hick's Law: at most four plain choices; everything else behind "More AIs".
	const topAgents = agentChoices.filter((a) => a.found || SUGGESTED.includes(a.id)).slice(0, onlyApps ? 4 : localModels.length ? 2 : 3);
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const matches = (a: AgentChoice) => {
		const text = `${friendlyName(a)} ${a.id} ${describeAgent(a)}`.toLowerCase();
		return words.every((w) => text.includes(w));
	};
	const pool = onlyApps ? agentChoices : all;
	const listed = showAll ? pool.filter(matches) : topAgents;
	const more = pool.length - topAgents.length;

	// What "Continue" would choose.
	const chosenId = selected === "local" ? localModel : selected === "api" ? apiModel : selected;
	const chosen = all.find((a) => a.id === chosenId);
	const isCurrent = Boolean(chosen && current && chosen.id === current.id);

	if (adding && !kind) return <KindPicker agents={agents} />;

	const heading = !adding
		? "Which AI do you use?"
		: onlyApps
			? "Add an AI app"
			: onlyLocal
				? "Add a model on this computer"
				: "Add an AI service";

	return (
		<Card variant="surface" size="3">
			<Flex direction="column" gap="4">
				<Steps current={1} />
				<Heading size="6">{heading}</Heading>
				{broken && (
					<Callout.Root color="amber" role="status">
						<Callout.Icon>
							<Icon name="alert" />
						</Callout.Icon>
						<Callout.Text>
							{problem === "not signed in"
								? `${friendlyName(broken)} is signed out. Choose it again to sign in, or pick another AI.`
								: `${plainReason(problem) ?? `${friendlyName(broken)} isn't working.`} Pick another AI, or choose it again to retry.`}
						</Callout.Text>
					</Callout.Root>
				)}
				<Text size="3" color="gray">
					{!adding
						? "Websites you allow will ask it to answer you. They can't see your files."
						: onlyLocal
							? "Answers stay on this computer. Pick the model to use."
							: onlyService
								? "Use the key the service gave you. Websites never see it."
								: "Sign in with your own account. Websites can't see your files."}
				</Text>
				{!agents && !error && (
					<Flex gap="2" align="center" role="status">
						<Spinner size="2" />
						<Text size="2" color="gray">
							Looking for the AIs on this computer…
						</Text>
					</Flex>
				)}
				{agents && showAll && (
					<TextField.Root
						size="3"
						placeholder="Filter by name"
						aria-label="Filter AIs"
						value={query}
						autoFocus
						onChange={(e) => void onboardingStore.filter(e.target.value)}
					>
						<TextField.Slot>
							<Icon name="search" />
						</TextField.Slot>
						{query && (
							<TextField.Slot>
								<Button variant="ghost" color="gray" size="1" aria-label="Clear filter" onClick={() => void onboardingStore.filter("")}>
									<Icon name="x" />
								</Button>
							</TextField.Slot>
						)}
					</TextField.Root>
				)}
				{agents && showAll && listed.length === 0 && (
					<Text size="2" color="gray">
						No AI matches "{query.trim()}".
					</Text>
				)}
				{agents && !onlyLocal && !onlyService && (
					<RadioCards.Root
						value={selected ?? undefined}
						onValueChange={(id) => void onboardingStore.select(id)}
						columns="1"
						gap="2"
						size="2"
						disabled={busy}
						style={showAll ? { maxHeight: 300, overflowY: "auto", padding: 2 } : undefined}
					>
						{listed.map((agent) => (
							<RadioCards.Item key={agent.id} value={agent.id}>
								<Flex direction="column" width="100%">
									<Text weight="bold">{friendlyName(agent)}</Text>
									<Text size="2" color="gray">
										{describeAgent(agent)}
									</Text>
								</Flex>
							</RadioCards.Item>
						))}
						{!adding && !showAll && localModels.length > 0 && (
							<RadioCards.Item value="local">
								<Flex direction="column" width="100%">
									<Text weight="bold">Keep everything on this computer</Text>
									<Text size="2" color="green">
										{[...new Set(localModels.map((m) => m.provider?.name))].join(" and ")} found · private and free
									</Text>
								</Flex>
							</RadioCards.Item>
						)}
						{!adding && !showAll && (
							<RadioCards.Item value="api">
								<Flex direction="column" width="100%">
									<Text weight="bold">Another AI service</Text>
									<Text size="2" color="gray">
										{apiModels.length ? `${apiModels[0]!.provider?.name} or a new one` : "Your company's AI, or one you pay for, with its key"}
									</Text>
								</Flex>
							</RadioCards.Item>
						)}
					</RadioCards.Root>
				)}

				{onlyLocal && agents && localModels.length === 0 && (
					<Callout.Root color="blue">
						<Callout.Icon>
							<Icon name="info" />
						</Callout.Icon>
						<Callout.Text>No model found on this computer. Open LM Studio or Ollama and download a model, then look again.</Callout.Text>
					</Callout.Root>
				)}
				{onlyLocal && agents && localModels.length === 0 && (
					<Button variant="soft" color="gray" style={{ alignSelf: "flex-start" }} onClick={() => void onboardingStore.reload()}>
						Look again
					</Button>
				)}
				{/* Adding a model is the point here: the picker shows, not folded. */}
				{onlyLocal && localModels.length > 0 && (
					<Flex direction="column" gap="1">
						<Text size="2" color="green">
							{[...new Set(localModels.map((m) => m.provider?.name))].join(" and ")} found · private and free
						</Text>
						<ModelPicker models={localModels} value={localModel} onChange={(id) => void onboardingStore.selectModel("local", id)} />
					</Flex>
				)}
				{!onlyLocal && selected === "local" && localModels.length > 0 && (
					<Disclosure label="Model" value={localModels.find((m) => m.id === localModel)?.model}>
						<ModelPicker models={localModels} value={localModel} onChange={(id) => void onboardingStore.selectModel("local", id)} />
					</Disclosure>
				)}
				{selected === "api" && (
					<Flex direction="column" gap="3">
						{apiModels.length > 0 &&
							(onlyService ? (
								<ModelPicker models={apiModels} value={apiModel} onChange={(id) => void onboardingStore.selectModel("api", id)} />
							) : (
								<Disclosure label="Model" value={apiModels.find((m) => m.id === apiModel)?.model}>
									<ModelPicker models={apiModels} value={apiModel} onChange={(id) => void onboardingStore.selectModel("api", id)} />
								</Disclosure>
							))}
						{apiModels.length > 0 && !apiFormOpen ? (
							<Button variant="ghost" color="gray" style={{ alignSelf: "flex-start" }} onClick={() => void onboardingStore.openApiForm()}>
								Add another service
							</Button>
						) : (
							<>
						{!(onlyService && apiModels.length === 0) && (
							<Text size="2" weight="bold">
								{apiModels.length ? "Add another service" : "Your AI service"}
							</Text>
						)}
						{/* Known services fill in their address (Tesler's Law); Other asks for it. */}
						<Flex direction="column" gap="2">
							<Text as="label" size="2" weight="medium">
								Service
							</Text>
							<Select.Root value={api.preset} onValueChange={(preset) => void onboardingStore.pickService(preset)}>
								<Select.Trigger aria-label="Service" />
								<Select.Content position="popper">
									{SERVICES.map((service) => (
										<Select.Item key={service.id} value={service.id}>
											{service.name}
										</Select.Item>
									))}
									<Select.Separator />
									<Select.Item value="other">Another service (your company's AI…)</Select.Item>
								</Select.Content>
							</Select.Root>
						</Flex>
						{api.preset === "other" && (
							<Field label="Name" placeholder="My company's AI" value={api.name} onChange={(name) => void onboardingStore.editApi({ name })} />
						)}
						{api.preset === "other" && (
						<Field
							label="Address"
							placeholder="https://api.example.com/v1"
							value={api.baseUrl}
							error={/\bkey\b/i.test(api.error) ? undefined : api.error}
							onChange={(baseUrl) => void onboardingStore.editApi({ baseUrl })}
						/>
						)}
						{api.preset !== "other" && /\bkey\b/i.test(api.error) === false && api.error && <Problem>{api.error}</Problem>}
						<Field
							label="API key"
							optional={api.preset === "other"}
							type="password"
							placeholder="Paste your key"
							error={/\bkey\b/i.test(api.error) ? api.error : undefined}
							value={api.apiKey}
							onChange={(apiKey) => void onboardingStore.editApi({ apiKey })}
						/>
						{/* The one ink action while nothing is connected yet (Von Restorff). */}
						{onlyService ? (
							<InkButton
								loading={api.busy}
								disabled={!api.baseUrl.trim() || (api.preset !== "other" && !api.apiKey.trim())}
								onClick={() => void onboardingStore.addApi()}
							>
								Connect {api.preset === "other" ? "this service" : api.name}
							</InkButton>
						) : (
							<Button variant="soft" color="gray" size="2" loading={api.busy} disabled={!api.baseUrl.trim()} onClick={() => void onboardingStore.addApi()}>
								Connect this service
							</Button>
						)}
							</>
						)}
					</Flex>
				)}

				{agents && !onlyLocal && !onlyService && !showAll && more > 0 && (
					<Button variant="ghost" color="gray" style={{ alignSelf: "flex-start" }} onClick={() => void onboardingStore.showAll()}>
						Show more AIs ({more})
					</Button>
				)}
				{error && <Problem>{error}</Problem>}
				{/* The button spins; this says what for. */}
				{busy && chosen && (
					<Text size="2" color="gray" role="status">
						{activityText(progress, friendlyName(chosen))}
					</Text>
				)}
				{onlyService && (apiFormOpen || apiModels.length === 0) ? null : isCurrent && current ? (
					<InkButton onClick={() => void appStore.refresh()}>Keep {friendlyName(current)}</InkButton>
				) : (
					<InkButton disabled={!chosen} loading={busy} onClick={() => chosen && void onboardingStore.choose(chosen)}>
						{chosen ? `Continue with ${friendlyName(chosen)}` : "Continue"}
					</InkButton>
				)}
				{current && !busy && !isCurrent && (
					<Button variant="ghost" color="gray" onClick={() => void appStore.refresh()}>
						Keep {friendlyName(current)}
					</Button>
				)}
				{adding && !busy && (
					<Button variant="ghost" color="gray" onClick={() => void onboardingStore.backToKinds()}>
						Back
					</Button>
				)}
			</Flex>
		</Card>
	);
}

function ModelPicker({
	models,
	value,
	onChange,
}: {
	models: AgentChoice[];
	value: string | null;
	onChange: (id: string) => void;
}) {
	return (
		<Flex direction="column" gap="1">
			<Select.Root value={value ?? undefined} onValueChange={onChange}>
				<Select.Trigger aria-label="Model" />
				<Select.Content position="popper">
					{models.map((m) => (
						<Select.Item key={m.id} value={m.id}>
							{m.model}
							{m.loaded ? " · ready now" : ""}
						</Select.Item>
					))}
				</Select.Content>
			</Select.Root>
		</Flex>
	);
}

/** A labelled text field: always a visible label; an error replaces the hint and says how to fix it. */
function Field({
	label,
	value,
	onChange,
	placeholder,
	optional,
	error,
	type = "text",
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	optional?: boolean;
	error?: string;
	type?: "text" | "password";
}) {
	return (
		<Flex direction="column" gap="2" asChild>
			<label>
				<Text size="2" weight="medium">
					{label}
					{optional && (
						<Text weight="regular" color="gray">
							{" "}
							· Optional
						</Text>
					)}
				</Text>
				<TextField.Root
					size="3"
					type={type}
					value={value}
					placeholder={placeholder}
					color={error ? "red" : undefined}
					aria-invalid={error ? true : undefined}
					autoComplete="off"
					spellCheck={false}
					onChange={(e) => onChange(e.target.value)}
				/>
				{error && (
					<Text size="2" color="red" role="alert">
						{error}
					</Text>
				)}
			</label>
		</Flex>
	);
}

/** A problem, said once where it happened (Callout, blocked). */
function Problem({ children }: { children: string }) {
	return (
		<Callout.Root color="red" role="alert">
			<Callout.Icon>
				<Icon name="alert" />
			</Callout.Icon>
			<Callout.Text>{children}</Callout.Text>
		</Callout.Root>
	);
}

/**
 * Adding an AI starts with what kind (Hick's Law: three plain choices),
 * each saying what Leuria found. The next screen shows only that kind.
 */
function KindPicker({ agents }: { agents: AgentChoice[] | null }) {
	const [kind, setKind] = useState<AiKind>("app");
	const all = agents ?? [];
	const localNames = [...new Set(all.filter((a) => a.kind === "llm" && a.local).map((a) => a.provider?.name))];
	const services = [...new Set(all.filter((a) => a.kind === "llm" && !a.local).map((a) => a.provider?.name))];
	const kinds: Array<{ value: AiKind; title: string; description: string; found?: boolean }> = [
		{ value: "app", title: "An AI app you use", description: "ChatGPT, Claude, Gemini… Sign in with your account." },
		{
			value: "local",
			title: "A model on this computer",
			description: localNames.length ? `${localNames.join(" and ")} found · private and free` : "With LM Studio or Ollama · private and free",
			found: localNames.length > 0,
		},
		{
			value: "service",
			title: "An AI service with a key",
			description: services.length ? `${services.join(", ")} or another one` : "OpenAI, Mistral, your company's AI…",
		},
	];
	return (
		<Card variant="surface" size="3">
			<Flex direction="column" gap="4">
				<Steps current={1} />
				<Heading size="6">Add an AI</Heading>
				<Text size="3" color="gray">
					Use it for some websites, or make it your default later.
				</Text>
				<RadioCards.Root value={kind} onValueChange={(value) => setKind(value as AiKind)} columns="1" gap="2" size="2">
					{kinds.map((k) => (
						<RadioCards.Item key={k.value} value={k.value}>
							<Flex direction="column" width="100%">
								<Text weight="bold">{k.title}</Text>
								<Text size="2" color={k.found ? "green" : "gray"}>
									{k.description}
								</Text>
							</Flex>
						</RadioCards.Item>
					))}
				</RadioCards.Root>
				<InkButton onClick={() => void onboardingStore.chooseKind(kind)}>Continue</InkButton>
				<Button variant="ghost" color="gray" onClick={() => void onboardingStore.startSetup().then(() => appStore.refresh())}>
					Cancel
				</Button>
			</Flex>
		</Card>
	);
}
