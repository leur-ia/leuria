import { BridgeStatus, Icon, type IconName, Logo } from "@leuria/pearl";
import { Badge, Box, Button, Callout, Card, DropdownMenu, Flex, Heading, IconButton, Link, Select, Spinner, Switch, Text, TextField } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@sinuxjs/react";
import { useEffect, useRef, useState } from "react";

import { AgentModelSelect } from "../components/AgentModelSelect";
import { AiChoiceCard } from "../components/AiChoiceCard";
import { CeilingSelect, DYNAMIC, DYNAMIC_WORDS, dynamicId, dynamicTitle, isDynamic } from "../components/DynamicSelection";
import { costWords, needsSentence, verdictOf, verdictWords } from "../fit-words";
import { Disclosure } from "../components/Disclosure";
import { SiteSkills } from "../components/SiteSkills";
import { type AgentModels, type DecisionModels, describeCheck, engine, errorMessage, TYPESAFE_URL, type Fit, type SearchModels, searchModelName, signInLabel, friendlyName, trayName, type Site, type Status, type TestResult, type YourAi } from "../engine";
import { appStore } from "../stores/app.store";
import { homeStore, type HomeTab } from "../stores/home.store";
import { onboardingStore } from "../stores/onboarding.store";

const DEFAULT = "default";
/** "Same as the AI" in a site's model list: a value no AI uses as a model id (Claude has a model named `default`). */
const SAME_MODEL = "leuria:same-as-ai";

export function Home({ status }: { status: Status }) {
	const { tab, sites, ais, autostart, checks, modelRefresh, settingUp, signInNeeded, aiModels, search, decisions, focus, fits, error } = useStore(homeStore);
	const models = useStore(appStore, (s) => s.models);

	useEffect(() => {
		void homeStore.load();
	}, [status]);
	useEffect(() => {
		void homeStore.loadAiModels();
	}, [ais]);
	// Looked for when the tab opens: the visitor may have loaded a model meanwhile.
	useEffect(() => {
		if (tab === "ais") void homeStore.loadSearch();
		// Decision models: the AIs tab chooses one, the Websites tab may give a site its own.
		if (tab === "ais" || tab === "sites") void homeStore.loadDecisions();
	}, [tab]);

	return (
		<div className="shell">
			{/* Pages in the sidebar: websites first, then your AIs, then settings. Room to grow. */}
			<nav className="sidebar" aria-label="Leuria">
				<div className="sidebar-brand">
					<Logo size={22} />
				</div>
				{PAGES.map((page) => (
					<button key={page.id} type="button" className="nav-item" aria-current={tab === page.id ? "page" : undefined} onClick={() => void homeStore.showTab(page.id)}>
						<Icon name={page.icon} size={18} />
						<span>{page.label}</span>
						{page.id === "sites" && sites.length > 0 && <span className="nav-count">{sites.length}</span>}
					</button>
				))}
				<div className="sidebar-foot">
					<BridgeStatus state="connected" size={1} />
					<UpdateFooter />
				</div>
			</nav>

			<main className="content">
				{tab === "sites" && (
					<Flex direction="column" gap="4">
						<Heading as="h1" size="4">
							Websites
						</Heading>
						<Card size="2">
							<Flex direction="column" gap="3">
								{sites.length === 0 ? (
									<Flex gap="3" align="start">
										<Text color="gray">
											<Icon name="globe" />
										</Text>
										<Text size="2" color="gray">
											No site yet. When a website offers "Connect your AI", Leuria asks you here first.
										</Text>
									</Flex>
								) : (
									<div>
										{sites.map((site) => (
											<SiteRow
												decisions={decisions}
												key={site.origin}
												site={site}
												status={status}
												ais={ais}
												models={site.agent && site.agent !== status.agent.id ? (aiModels[site.agent] ?? null) : models}
												busy={settingUp === site.origin}
												signInNeeded={signInNeeded?.origin === site.origin ? signInNeeded : null}
												focused={focus === site.origin}
												fit={fits[site.origin] ?? null}
											/>
										))}
									</div>
								)}
								{error && (
									<Callout.Root color="red" size="1" role="alert">
										<Callout.Icon>
											<Icon name="alert" />
										</Callout.Icon>
										<Callout.Text>{error}</Callout.Text>
									</Callout.Root>
								)}
							</Flex>
						</Card>
					</Flex>
				)}

				{tab === "ais" && (
					<Flex direction="column" gap="4">
						<Heading as="h1" size="4">
							Your AIs
						</Heading>
						<Card size="2">
							<div>
								{(ais.length
									? ais
									: [
											{
												id: status.agent.id,
												name: status.agent.name,
												kind: "agent" as const,
												default: true,
												ready: true,
											},
										]
								).map((ai) => (
									<AiRow key={ai.id} ai={ai} models={ai.default ? models : (aiModels[ai.id] ?? null)} check={checks[ai.id]} refresh={modelRefresh[ai.id]} />
								))}
								{/* Closes the list: the one way to grow it. */}
								<div className="ai-row ai-add">
									<Button variant="ghost" color="gray" onClick={() => void onboardingStore.startAdd(ais.map((ai) => ai.id)).then(() => appStore.startOnboarding())}>
										<Icon name="plus" size={16} />
										Add an AI
									</Button>
								</div>
							</div>
						</Card>
						<SearchCard search={search} error={error} />
						<DecisionsCard decisions={decisions} error={error} />
					</Flex>
				)}

				{tab === "settings" && (
					<Flex direction="column" gap="4">
						<Heading as="h1" size="4">
							Settings
						</Heading>
						<Card size="2">
							<Text as="label" size="2">
								<Flex gap="3" align="center" justify="between">
									<Flex direction="column">
										<Text weight="medium">Start Leuria when I log in</Text>
										<Text size="1" color="gray">
											Websites can use your AI right away. Leuria waits in the {trayName}.
										</Text>
									</Flex>
									<Switch checked={autostart} onCheckedChange={() => void homeStore.toggleAutostart()} />
								</Flex>
							</Text>
						</Card>
					</Flex>
				)}
			</main>
		</div>
	);
}

/** The version, and "Check for updates" in plain words; a found update waits for a restart. */
function UpdateFooter() {
	const { appVersion, update } = useStore(appStore, (s) => ({
		appVersion: s.appVersion,
		update: s.update,
	}));

	useEffect(() => {
		void appStore.loadUpdate();
	}, []);

	if (update.phase === "ready") {
		return (
			<Flex direction="column" gap="2">
				<Text size="1" color="gray">
					Leuria {update.version} is ready.
				</Text>
				<Button size="1" onClick={() => void invoke("restart_app")}>
					Restart to update
				</Button>
			</Flex>
		);
	}
	return (
		<Flex direction="column" gap="1">
			{update.phase === "checking" ? (
				<Flex gap="2" align="center" role="status">
					<Spinner size="1" />
					<Text size="1" color="gray">
						Looking for updates…
					</Text>
				</Flex>
			) : (
				<button type="button" className="text-link foot-link" onClick={() => void appStore.checkUpdate()}>
					{update.phase === "failed" ? "Couldn't check. Try again" : "Check for updates"}
				</button>
			)}
			<Text size="1" color="gray">
				{update.phase === "latest" ? `Leuria ${appVersion} is up to date` : `Leuria ${appVersion}`}
			</Text>
		</Flex>
	);
}

const PAGES: { id: HomeTab; label: string; icon: IconName }[] = [
	{ id: "sites", label: "Websites", icon: "globe" },
	{ id: "ais", label: "Your AIs", icon: "chat" },
	{ id: "settings", label: "Settings", icon: "settings" },
];

function SiteRow({
	site,
	status,
	ais,
	models,
	busy,
	signInNeeded,
	focused,
	fit,
	decisions,
}: {
	site: Site;
	status: Status;
	ais: YourAi[];
	/** Models of the site's AI, when it lets you choose. */
	models: AgentModels | null;
	busy: boolean;
	signInNeeded: {
		agent: string;
		status: { methods: Array<{ id: string; name: string }>; window?: boolean };
	} | null;
	/** The site asked (from the visitor's click on it) to change its AI or model: shown open. */
	focused: boolean;
	/** How Your AIs fit what the site said it needs. */
	fit: Fit | null;
	/** Decision models on this computer, and the one every site gets. */
	decisions: DecisionModels | null;
}) {
	// A site picks among Your AIs (Add an AI puts more here).
	const choices = ais.filter((a) => !a.default);
	const method = signInNeeded?.status.methods[0];
	// The site's own model counts only for the AI it was chosen with.
	const siteAgent = site.agent ?? status.agent.id;
	const ownModel = site.model?.agent === siteAgent ? site.model.id : undefined;
	const aiChoice = models?.options.find((m) => m.id === models.current)?.name;
	// The folded line says what the site uses: "Uses the default", "Uses Claude · Sonnet 5".
	const dynamic = isDynamic(site.agent);
	const ownAi = site.agent && site.agent !== status.agent.id ? ais.find((a) => a.id === site.agent) : undefined;
	const usesAi = dynamic ? DYNAMIC_WORDS.toLowerCase() : ownAi ? friendlyName(ownAi) : "the default";
	const ownModelName = ownModel ? (models?.options.find((m) => m.id === ownModel)?.name ?? ownModel) : undefined;
	const siteName = site.app ?? new URL(site.origin).host;
	// Decisions: the site follows the choice every site gets, or has its own (a model here, off, or a service set from the engine).
	const siteDecide = site.decide === undefined ? FOLLOW : site.decide === "off" ? OFF : "provider" in site.decide ? modelValue(site.decide.provider, site.decide.model) : SERVICE;
	const everyone = decisions?.current ? `${decisions.current.model} · ${decisions.current.name}` : "none";
	// What answers this site, what it costs, and how it fits what the site said it needs.
	const current = ownModel ?? models?.current;
	const currentName = models?.options.find((m) => m.id === current)?.name;
	const currentAiName = dynamic ? DYNAMIC_WORDS : ownAi ? friendlyName(ownAi) : friendlyName(status.agent);
	const fitAi = fit?.ais.find((a) => a.id === siteAgent);
	// On dynamic selection, what the site would get right now is the recommendation within its ceiling.
	const currentCost = dynamic ? fit?.recommended?.cost : (fitAi?.models.find((m) => m.id === current)?.cost ?? fitAi?.cost);
	const declared = Boolean(fit?.needs);
	const currentVerdict = declared && !dynamic ? verdictOf(fit, siteAgent, current) : undefined;
	const best = declared && !dynamic ? (fit?.recommended ?? null) : null;
	const bestAi = best ? ais.find((a) => a.id === best.agent) : undefined;
	const onBest = best !== null && best.agent === siteAgent && (best.model === null || best.model === current);
	const row = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (focused) row.current?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [focused]);
	return (
		<div className={focused ? "site-row focused" : "site-row"} ref={row}>
			<Flex align="center" gap="3">
				<Flex direction="column" flexGrow="1" minWidth="0">
					<Text weight="bold" truncate>
						{siteName}
					</Text>
					{/* The address opens the site in the browser. */}
					<Text size="1" truncate>
						<Link asChild color="gray">
							<button type="button" className="text-link" onClick={() => void invoke("open_link", { url: site.origin })}>
								{site.origin}
							</button>
						</Link>
					</Text>
				</Flex>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						<IconButton variant="ghost" color="gray" aria-label={`More for ${siteName}`}>
							<Icon name="more" />
						</IconButton>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item onSelect={() => void invoke("open_link", { url: site.origin })}>Open the site</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item color="red" onSelect={() => void homeStore.disconnect(site.origin)}>
							Disconnect
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Flex>
			{/* Advanced: which AI and model this site uses, folded into one line that says it. */}
			<Flex align="start" gap="2">
				<Box flexGrow="1" minWidth="0">
					<Disclosure
						key={focused ? "focused" : "row"}
						label={`Uses ${usesAi}${ownModelName ? ` · ${ownModelName}` : ""}`}
						value={verdictWords(currentVerdict).replace(/^ · /, "") || undefined}
						defaultOpen={focused}
						onOpen={() => void homeStore.loadFit(site.origin)}
					>
						<AiChoiceCard
							title={dynamic ? dynamicTitle(fit, ais) : currentName ? ` · ` : currentAiName}
							cost={costWords(currentCost, currentAiName)}
							verdict={currentVerdict}
							needs={needsSentence(site.needs)}
							busy={busy}
							suggestion={
								best && bestAi && !onBest
									? {
											title: `${friendlyName(bestAi)}${best.modelName ? ` · ${best.modelName}` : ""}`,
											cost: costWords(best.cost, friendlyName(bestAi)),
											onUse: async () => {
												await homeStore.setSiteAgent(site.origin, best.isDefault ? null : best.agent);
												if (best.model !== null) await homeStore.setSiteModel(site.origin, best.model);
											},
										}
									: undefined
							}
						>
							<Flex direction="column" gap="1">
								<Text as="label" size="2" weight="medium">
									AI
								</Text>
								<Select.Root
									value={dynamic ? DYNAMIC : site.agent && site.agent !== status.agent.id ? site.agent : DEFAULT}
									disabled={busy}
									onValueChange={(value) => void homeStore.setSiteAgent(site.origin, value === DEFAULT ? null : value === DYNAMIC ? dynamicId("plan") : value)}
								>
									<Select.Trigger aria-label={`AI for ${site.origin}`} style={{ width: "100%" }} />
									<Select.Content position="popper">
										<Select.Item value={DEFAULT}>
											Default · {friendlyName(status.agent)}
											{verdictWords(verdictOf(fit, status.agent.id))}
										</Select.Item>
										{choices.length > 0 && <Select.Separator />}
										{choices.map((agent) => (
											<Select.Item key={agent.id} value={agent.id}>
												{friendlyName(agent)}
												{verdictWords(verdictOf(fit, agent.id))}
											</Select.Item>
										))}
										{choices.length > 0 && (
											<>
												<Select.Separator />
												<Select.Item value={DYNAMIC}>{DYNAMIC_WORDS}</Select.Item>
											</>
										)}
									</Select.Content>
								</Select.Root>
							</Flex>
							{dynamic && site.agent && <CeilingSelect id={site.agent} host={siteName} disabled={busy} onChange={(id) => void homeStore.setSiteAgent(site.origin, id)} />}
							{(site.needs?.decide || site.decide !== undefined || (decisions?.models.length ?? 0) > 0) && (
								<Flex direction="column" gap="1">
									<Text as="label" size="2" weight="medium">
										Decision model
									</Text>
									<Select.Root
										value={siteDecide}
										disabled={busy}
										onValueChange={(value) => {
											if (value === SERVICE) return;
											const found = decisions?.models.find((m) => modelValue(m.provider.id, m.model) === value);
											void homeStore.setSiteDecide(site.origin, value === FOLLOW ? null : value === OFF ? "off" : found ? { provider: found.provider.id, model: found.model } : null);
										}}
									>
										<Select.Trigger aria-label={`Decision model for ${site.origin}`} style={{ width: "100%" }} />
										<Select.Content position="popper">
											<Select.Item value={FOLLOW}>Same as every site · {everyone}</Select.Item>
											{(decisions?.models.length ?? 0) > 0 && <Select.Separator />}
											{decisions?.models.map((m) => (
												<Select.Item key={modelValue(m.provider.id, m.model)} value={modelValue(m.provider.id, m.model)}>
													{m.model} · {m.provider.name}
												</Select.Item>
											))}
											{siteDecide === SERVICE && site.decide && typeof site.decide === "object" && "baseUrl" in site.decide && (
												<Select.Item value={SERVICE}>
													{site.decide.model ?? "jev-latest"} · {site.decide.baseUrl === TYPESAFE_URL ? "TypeSafe" : site.decide.baseUrl}
												</Select.Item>
											)}
											<Select.Separator />
											<Select.Item value={OFF}>Off for this site</Select.Item>
										</Select.Content>
									</Select.Root>
								</Flex>
							)}
							{models && models.options.length > 1 && !busy && (
								<Flex direction="column" gap="1">
									<Text as="label" size="2" weight="medium">
										Model
									</Text>
									<Select.Root value={ownModel ?? SAME_MODEL} onValueChange={(value) => void homeStore.setSiteModel(site.origin, value === SAME_MODEL ? null : value)}>
										<Select.Trigger aria-label={`Model for ${site.origin}`} style={{ width: "100%" }} />
										<Select.Content position="popper">
											<Select.Item value={SAME_MODEL}>{aiChoice ? `Same as the AI · ${aiChoice}` : "Same as the AI"}</Select.Item>
											<Select.Separator />
											{models.options.map((m) => (
												<Select.Item key={m.id} value={m.id}>
													{m.name}
													{verdictWords(verdictOf(fit, siteAgent, m.id))}
												</Select.Item>
											))}
										</Select.Content>
									</Select.Root>
								</Flex>
							)}
						</AiChoiceCard>
					</Disclosure>
				</Box>
				{busy && <Spinner size="1" />}
			</Flex>
			{site.skills && <SiteSkills list={site.skills.list} />}
			{signInNeeded?.status.window ? (
				<Button size="1" variant="soft" style={{ alignSelf: "flex-start" }} onClick={() => void homeStore.signInSiteAgent()}>
					Sign in to {friendlyName({ id: signInNeeded.agent, name: signInNeeded.agent })} for this site
				</Button>
			) : (
				method && (
					<Button size="1" variant="soft" style={{ alignSelf: "flex-start" }} onClick={() => void homeStore.signInSiteAgent(method.id)}>
						{signInLabel(method)} for this site
					</Button>
				)
			)}
		</div>
	);
}

const AUTO = "auto";
const OFF = "off";
const FOLLOW = "follow";
const SERVICE = "service";
const TYPESAFE = "typesafe";
const OTHER = "other";
const modelValue = (provider: string, model: string) => `${provider}\u0000${model}`;

/**
 * Decisions: some sites ask a System One model typed questions. A model
 * on this computer (nimble, tev1… in LM Studio or Ollama), or a service:
 * TypeSafe with the visitor's key, or any other speaking the same API.
 */
function DecisionsCard({ decisions, error }: { decisions: DecisionModels | null; error: string }) {
	const choice = decisions?.choice ?? AUTO;
	const service = typeof choice === "object" && "baseUrl" in choice ? choice : null;
	const chosen = typeof choice === "object" && "provider" in choice ? choice : null;
	const chosenMissing = chosen !== null && decisions !== null && !decisions.models.some((m) => m.provider.id === chosen.provider && m.model === chosen.model);
	const value = service ? (service.baseUrl === TYPESAFE_URL ? TYPESAFE : OTHER) : chosen ? modelValue(chosen.provider, chosen.model) : choice === OFF ? OFF : AUTO;
	/** A service being set up: its fields, until Save. */
	const [editing, setEditing] = useState<typeof TYPESAFE | typeof OTHER | null>(null);
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("");
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	/** What a look at the service found: its models, and how a try went. */
	const [probe, setProbe] = useState<{ models: Array<{ id: string; decision: boolean }>; tried?: { model: string; ok: boolean; ms: number; error?: string }; error?: string } | null>(null);
	const look = async (tryModel?: string) => {
		setBusy(true);
		try {
			const found = await engine.probeDecisionService({ baseUrl, ...(key.trim() ? { apiKey: key } : {}), ...(tryModel ? { model: tryModel } : {}) });
			setProbe(found);
			if (!model && found.tried) setModel(found.tried.model);
		} catch (error) {
			setProbe({ models: [], error: errorMessage(error) });
		} finally {
			setBusy(false);
		}
	};
	const onChange = (next: string) => {
		setEditing(null);
		setProbe(null);
		if (next === TYPESAFE || next === OTHER) return setEditing(next);
		if (next === AUTO || next === OFF) return void homeStore.setDecisions(next);
		const found = decisions?.models.find((m) => modelValue(m.provider.id, m.model) === next);
		if (found) void homeStore.setDecisions({ provider: found.provider.id, model: found.model });
	};
	const save = async () => {
		setBusy(true);
		await homeStore.setDecisions(editing === OTHER ? { baseUrl, ...(key.trim() ? { apiKey: key } : {}), ...(model.trim() ? { model } : {}) } : { apiKey: key });
		setBusy(false);
		setEditing(null);
		setKey("");
	};

	let line: string;
	if (!decisions) line = "Looking for a decision model…";
	else if (choice === OFF) line = "Off: sites can't use a decision model.";
	else if (chosenMissing) line = `${chosen.model} isn't available now. Open ${decisions.models.find((m) => m.provider.id === chosen.provider)?.provider.name ?? chosen.provider} and pull it, or choose another.`;
	else if (decisions.current?.local) line = `Sites decide with ${decisions.current.model} · ${decisions.current.name}, on this computer.`;
	else if (decisions.current) line = `Sites decide with ${decisions.current.model} · ${decisions.current.name}${decisions.current.local ? ", on this computer" : service?.hasKey ? ", with your key" : ""}.`;
	else line = "No decision model on this computer yet. Load one in LM Studio or Ollama (nimble, for example), or use a service.";

	const label = choice === AUTO ? "Automatic" : choice === OFF ? "Off" : service ? (service.baseUrl === TYPESAFE_URL ? "TypeSafe" : service.baseUrl) : chosen!.model;
	return (
		<section className="page-section" aria-labelledby="decisions-heading">
			<Flex direction="column" gap="1">
				<Heading as="h2" size="4" id="decisions-heading">
					Decisions
				</Heading>
				<Text size="2" color="gray">
					Some websites sort, score or route things with a decision model instead of a chat. On this computer it stays here; a service answers on your key.
				</Text>
			</Flex>
			<Card size="2">
				<Flex direction="column" gap="3">
					<Flex gap="2" align="center" role="status">
						{decisions?.current && choice !== OFF && !chosenMissing && (
							<Text color="green">
								<Icon name="check" size={16} />
							</Text>
						)}
						<Text size="2">{line}</Text>
					</Flex>
					{decisions && (
						<Disclosure label="Decision model" value={label}>
							<Flex direction="column" gap="2">
								<Select.Root value={editing ?? value} onValueChange={onChange}>
									<Select.Trigger aria-label="Decision model" style={{ width: "100%" }} />
									<Select.Content position="popper">
										<Select.Item value={AUTO}>Automatic · the first one on this computer</Select.Item>
										{decisions.models.length > 0 && <Select.Separator />}
										{decisions.models.map((m) => (
											<Select.Item key={modelValue(m.provider.id, m.model)} value={modelValue(m.provider.id, m.model)}>
												{m.model} · {m.provider.name}
											</Select.Item>
										))}
										{chosenMissing && <Select.Item value={value}>{chosen.model} (not available now)</Select.Item>}
										<Select.Separator />
										<Select.Item value={TYPESAFE}>TypeSafe (Jev) · with your key</Select.Item>
										<Select.Item value={OTHER}>Another service (your company's…)</Select.Item>
										<Select.Separator />
										<Select.Item value={OFF}>Off</Select.Item>
									</Select.Content>
								</Select.Root>
								{editing && (
									<Flex direction="column" gap="2">
										{editing === OTHER && <TextField.Root placeholder="Address, e.g. http://localhost:8000/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Address" />}
										{editing === OTHER && probe && probe.models.length > 0 ? (
											<Select.Root value={model} onValueChange={setModel}>
												<Select.Trigger aria-label="Model" placeholder="Model" style={{ width: "100%" }} />
												<Select.Content position="popper">
													{probe.models.map((m) => (
														<Select.Item key={m.id} value={m.id}>
															{m.id}
															{m.decision ? " · decision model" : ""}
														</Select.Item>
													))}
												</Select.Content>
											</Select.Root>
										) : (
											editing === OTHER && <TextField.Root placeholder="Model, as the service names it (e.g. Tev1-4B-openjev)" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" />
										)}
										<Flex gap="2" align="center">
											<TextField.Root
												type="password"
												placeholder={editing === OTHER ? "API key, if it needs one" : "Paste your TypeSafe key"}
												value={key}
												onChange={(e) => setKey(e.target.value)}
												style={{ flexGrow: 1 }}
												aria-label="API key"
											/>
											{editing === OTHER && (
												<Button variant="soft" color="gray" size="2" loading={busy} disabled={!baseUrl.trim()} onClick={() => void look(model.trim() || undefined)}>
													{probe?.models.length ? "Try" : "Find models"}
												</Button>
											)}
											<Button variant="soft" size="2" loading={busy} disabled={editing === OTHER ? !baseUrl.trim() : !key.trim()} onClick={() => void save()}>
												Save
											</Button>
										</Flex>
										{probe?.error && (
											<Text size="2" color="red">
												{probe.error}
											</Text>
										)}
										{probe && !probe.error && !probe.tried && <Text size="2" color="gray">{probe.models.length ? "Pick a model, then Try." : "This service lists no model."}</Text>}
										{probe?.tried && (
											<Text size="2" color={probe.tried.ok ? "green" : "red"}>
												{probe.tried.ok ? `${probe.tried.model} answered in ${probe.tried.ms} ms. Save to use it.` : `${probe.tried.model}: ${probe.tried.error}`}
											</Text>
										)}
									</Flex>
								)}
							</Flex>
						</Disclosure>
					)}
					{error && (
						<Callout.Root color="red" size="1" role="alert">
							<Callout.Icon>
								<Icon name="alert" />
							</Callout.Icon>
							<Callout.Text>{error}</Callout.Text>
						</Callout.Root>
					)}
				</Flex>
			</Card>
		</section>
	);
}

/**
 * Search by meaning: some sites search their own pages with a model on
 * this computer. Which one they get (the first found, one chosen, or
 * none), in the visitor's words.
 */
function SearchCard({ search, error }: { search: SearchModels | null; error: string }) {
	const choice = search?.choice ?? AUTO;
	const value = typeof choice === "string" ? choice : modelValue(choice.provider, choice.model);
	const chosenMissing = typeof choice === "object" && search && !search.models.some((m) => m.provider.id === choice.provider && m.model === choice.model);
	const onChange = (next: string) => {
		if (next === AUTO || next === OFF) return void homeStore.setSearch(next);
		const found = search?.models.find((m) => modelValue(m.provider.id, m.model) === next);
		if (found)
			void homeStore.setSearch({
				provider: found.provider.id,
				model: found.model,
			});
	};

	let line: string;
	if (!search) line = "Looking for a search model…";
	else if (choice === OFF) line = "Off: sites can't search with a model on this computer.";
	else if (chosenMissing && typeof choice === "object") {
		const service = ({ lmstudio: "LM Studio", ollama: "Ollama" } as Record<string, string>)[choice.provider] ?? choice.provider;
		line = `${searchModelName(choice.model)} isn't available now. Open ${service} and load it, or choose another.`;
	} else if (search.current) line = `Sites use ${searchModelName(search.current.model)} · ${search.current.provider.name}, on this computer.`;
	else line = "No search model on this computer yet. Load one in LM Studio or Ollama (nomic-embed-text, for example).";

	return (
		<section className="page-section" aria-labelledby="search-heading">
			<Flex direction="column" gap="1">
				<Heading as="h2" size="4" id="search-heading">
					Search by meaning
				</Heading>
				<Text size="2" color="gray">
					Some websites search their own pages by meaning, with a model on this computer. What you search stays here.
				</Text>
			</Flex>
			<Card size="2">
				<Flex direction="column" gap="3">
					<Flex gap="2" align="center" role="status">
						{search?.current && choice !== OFF && !chosenMissing && (
							<Text color="green">
								<Icon name="check" size={16} />
							</Text>
						)}
						<Text size="2">{line}</Text>
					</Flex>
					{search && (search.models.length > 0 || choice !== AUTO) && (
						<Disclosure label="Search model" value={choice === AUTO ? "Automatic" : choice === OFF ? "Off" : searchModelName((choice as { model: string }).model)}>
							<Select.Root value={value} onValueChange={onChange}>
								<Select.Trigger aria-label="Search model" style={{ width: "100%" }} />
								<Select.Content position="popper">
									<Select.Item value={AUTO}>Automatic · the first one found</Select.Item>
									{search.models.length > 0 && <Select.Separator />}
									{search.models.map((m) => (
										<Select.Item key={modelValue(m.provider.id, m.model)} value={modelValue(m.provider.id, m.model)}>
											{searchModelName(m.model)} · {m.provider.name}
										</Select.Item>
									))}
									{chosenMissing && typeof choice === "object" && <Select.Item value={value}>{searchModelName(choice.model)} (not available now)</Select.Item>}
									<Select.Separator />
									<Select.Item value={OFF}>Off</Select.Item>
								</Select.Content>
							</Select.Root>
						</Disclosure>
					)}
					{error && (
						<Callout.Root color="red" size="1" role="alert">
							<Callout.Icon>
								<Icon name="alert" />
							</Callout.Icon>
							<Callout.Text>{error}</Callout.Text>
						</Callout.Root>
					)}
				</Flex>
			</Card>
		</section>
	);
}

/**
 * One of Your AIs: its name, the Default badge, a menu for the rare
 * actions (Make default, Check that it works, Remove) and its model,
 * folded. Only services say where they run.
 */
function AiRow({
	ai,
	models,
	check,
	refresh,
}: {
	ai: YourAi;
	models: AgentModels | null;
	check?: TestResult | "running";
	/** "Refresh models": running, or whether the AI answered. */
	refresh?: "running" | "done" | "stale";
}) {
	const where = ai.kind === "llm" ? (ai.local ? "On this computer" : "Online service") : null;
	const name = friendlyName(ai);
	const failed = check && check !== "running" && !check.ok ? check.steps.findIndex((step) => !step.ok) : -1;
	return (
		<div className="ai-row">
			<Flex align="center" gap="3">
				<Flex direction="column" flexGrow="1" minWidth="0">
					<Text weight="bold" truncate>
						{name}
					</Text>
					{where && (
						<Text size="1" color="gray">
							{where}
						</Text>
					)}
				</Flex>
				{ai.default && (
					<Badge color="gray" variant="soft" size="2">
						Default
					</Badge>
				)}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						<IconButton variant="ghost" color="gray" aria-label={`More for ${name}`}>
							<Icon name="more" />
						</IconButton>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						{!ai.default && <DropdownMenu.Item onSelect={() => void homeStore.makeDefault(ai.id)}>Make default</DropdownMenu.Item>}
						<DropdownMenu.Item disabled={check === "running"} onSelect={() => void homeStore.checkAi(ai.id)}>
							Check that it works
						</DropdownMenu.Item>
						{/* A service with its model fixed in its name has no list to refresh. */}
						{(ai.kind === "agent" || !ai.model) && (
							<DropdownMenu.Item disabled={refresh === "running"} onSelect={() => void homeStore.refreshAiModels(ai.id)}>
								Refresh models
							</DropdownMenu.Item>
						)}
						{!ai.default && (
							<>
								<DropdownMenu.Separator />
								<DropdownMenu.Item color="red" onSelect={() => void homeStore.removeAi(ai.id)}>
									Remove
								</DropdownMenu.Item>
							</>
						)}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Flex>
			{models && models.options.length > 1 && (
				<Disclosure label="Model" value={models.options.find((m) => m.id === models.current)?.name}>
					<AgentModelSelect models={models} onChange={(id) => void (ai.default ? appStore.setModel(id) : homeStore.setAiModel(ai.id, id))} />
				</Disclosure>
			)}
			{refresh === "running" && (
				<Flex gap="2" align="center" role="status">
					<Spinner size="1" />
					<Text size="1" color="gray">
						{`Looking for ${name}'s models…`}
					</Text>
				</Flex>
			)}
			{(refresh === "done" || refresh === "stale") && (
				<Text size="1" color="gray" role="status">
					{refresh === "done"
						? models && models.options.length > 1
							? `Models up to date: ${models.options.length} to choose from.`
							: "Models up to date."
						: `${name} didn't answer, so its models weren't updated. Try again in a moment.`}
				</Text>
			)}
			{/* The check's result, in the row it belongs to: colour and words. */}
			{check === "running" && (
				<Flex gap="2" align="center" role="status">
					<Spinner size="1" />
					<Text size="1" color="gray">
						{`Asking ${name} a first question…`}
					</Text>
				</Flex>
			)}
			{check && check !== "running" && (
				<Flex gap="1" align="center" role="status">
					<Text size="1" color={check.ok ? "green" : "red"}>
						<Icon name={check.ok ? "check" : "alert"} size={14} />
					</Text>
					<Text size="1" color={check.ok ? "green" : "red"}>
						{check.ok ? "Works, and can't reach your files." : describeCheck(failed, false)}
					</Text>
				</Flex>
			)}
		</div>
	);
}
