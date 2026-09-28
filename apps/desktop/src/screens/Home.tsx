import { Icon } from "@leuria/pearl";
import { Badge, Box, Button, Callout, Card, DropdownMenu, Flex, IconButton, Link, Select, Spinner, Switch, Tabs, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@sinuxjs/react";
import { useEffect, useRef } from "react";

import { AgentModelSelect } from "../components/AgentModelSelect";
import { AiChoiceCard } from "../components/AiChoiceCard";
import { costWords, needsSentence, verdictOf, verdictWords } from "../fit-words";
import { Disclosure } from "../components/Disclosure";
import { type AgentModels, describeCheck, type Fit, type SearchModels, searchModelName, signInLabel, friendlyName, trayName, type Site, type Status, type TestResult, type YourAi } from "../engine";
import { appStore } from "../stores/app.store";
import { homeStore } from "../stores/home.store";
import { onboardingStore } from "../stores/onboarding.store";

const DEFAULT = "default";
/** "Same as the AI" in a site's model list: a value no AI uses as a model id (Claude has a model named `default`). */
const SAME_MODEL = "leuria:same-as-ai";

export function Home({ status }: { status: Status }) {
	const { tab, sites, ais, autostart, checks, settingUp, signInNeeded, aiModels, search, focus, fits, error } = useStore(homeStore);
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
	}, [tab]);

	return (
		<Flex direction="column" gap="4">
			{/* Miller's Law: websites first, the AIs on their own tab. */}
			<Tabs.Root value={tab} onValueChange={(value) => void homeStore.showTab(value as "sites" | "ais")}>
				<Tabs.List>
					<Tabs.Trigger value="sites">Websites</Tabs.Trigger>
					<Tabs.Trigger value="ais">Your AIs</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="sites">
					<Flex direction="column" gap="4" pt="4">
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
				</Tabs.Content>
				<Tabs.Content value="ais">
					<Flex direction="column" gap="4" pt="4">
						<Card size="2">
							<div>
								{(ais.length ? ais : [{ id: status.agent.id, name: status.agent.name, kind: "agent" as const, default: true, ready: true }]).map((ai) => (
									<AiRow key={ai.id} ai={ai} models={ai.default ? models : (aiModels[ai.id] ?? null)} check={checks[ai.id]} />
								))}
								{/* Closes the list: the one way to grow it. */}
								<div className="ai-row ai-add">
									<Button
										variant="ghost"
										color="gray"
										onClick={() => void onboardingStore.startAdd(ais.map((ai) => ai.id)).then(() => appStore.startOnboarding())}
									>
										<Icon name="plus" size={16} />
										Add an AI
									</Button>
								</div>
							</div>
						</Card>
						<SearchCard search={search} error={tab === "ais" ? error : ""} />
					</Flex>
				</Tabs.Content>
			</Tabs.Root>

			<Text size="1" color="gray" align="center">
				Leuria {status.version}
			</Text>
		</Flex>
	);
}

function SiteRow({
	site,
	status,
	ais,
	models,
	busy,
	signInNeeded,
	focused,
	fit,
}: {
	site: Site;
	status: Status;
	ais: YourAi[];
	/** Models of the site's AI, when it lets you choose. */
	models: AgentModels | null;
	busy: boolean;
	signInNeeded: { agent: string; status: { methods: Array<{ id: string; name: string }> } } | null;
	/** The site asked (from the visitor's click on it) to change its AI or model: shown open. */
	focused: boolean;
	/** How Your AIs fit what the site said it needs. */
	fit: Fit | null;
}) {
	// A site picks among Your AIs (Add an AI puts more here).
	const choices = ais.filter((a) => !a.default);
	const method = signInNeeded?.status.methods[0];
	// The site's own model counts only for the AI it was chosen with.
	const siteAgent = site.agent ?? status.agent.id;
	const ownModel = site.model?.agent === siteAgent ? site.model.id : undefined;
	const aiChoice = models?.options.find((m) => m.id === models.current)?.name;
	// The folded line says what the site uses: "Uses the default", "Uses Claude · Sonnet 5".
	const ownAi = site.agent && site.agent !== status.agent.id ? ais.find((a) => a.id === site.agent) : undefined;
	const usesAi = ownAi ? friendlyName(ownAi) : "the default";
	const ownModelName = ownModel ? (models?.options.find((m) => m.id === ownModel)?.name ?? ownModel) : undefined;
	const siteName = site.app ?? new URL(site.origin).host;
	// What answers this site, what it costs, and how it fits what the site said it needs.
	const current = ownModel ?? models?.current;
	const currentName = models?.options.find((m) => m.id === current)?.name;
	const currentAiName = ownAi ? friendlyName(ownAi) : friendlyName(status.agent);
	const fitAi = fit?.ais.find((a) => a.id === siteAgent);
	const currentCost = fitAi?.models.find((m) => m.id === current)?.cost ?? fitAi?.cost;
	const declared = Boolean(fit?.needs);
	const currentVerdict = declared ? verdictOf(fit, siteAgent, current) : undefined;
	const best = declared ? (fit?.recommended ?? null) : null;
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
						title={currentName ? `${currentAiName} · ${currentName}` : currentAiName}
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
								value={site.agent && site.agent !== status.agent.id ? site.agent : DEFAULT}
								disabled={busy}
								onValueChange={(value) => void homeStore.setSiteAgent(site.origin, value === DEFAULT ? null : value)}
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
								</Select.Content>
							</Select.Root>
						</Flex>
						{models && models.options.length > 1 && !busy && (
							<Flex direction="column" gap="1">
								<Text as="label" size="2" weight="medium">
									Model
								</Text>
								<Select.Root
									value={ownModel ?? SAME_MODEL}
									onValueChange={(value) => void homeStore.setSiteModel(site.origin, value === SAME_MODEL ? null : value)}
								>
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
			{method && (
				<Button size="1" variant="soft" style={{ alignSelf: "flex-start" }} onClick={() => void homeStore.signInSiteAgent(method.id)}>
					{signInLabel(method)} for this site
				</Button>
			)}
		</div>
	);
}

const AUTO = "auto";
const OFF = "off";
const modelValue = (provider: string, model: string) => `${provider}\u0000${model}`;

/**
 * Search by meaning: some sites search their own pages with a model on
 * this computer. Which one they get (the first found, one chosen, or
 * none), in the visitor's words.
 */
function SearchCard({ search, error }: { search: SearchModels | null; error: string }) {
	const choice = search?.choice ?? AUTO;
	const value = typeof choice === "string" ? choice : modelValue(choice.provider, choice.model);
	const chosenMissing =
		typeof choice === "object" && search && !search.models.some((m) => m.provider.id === choice.provider && m.model === choice.model);
	const onChange = (next: string) => {
		if (next === AUTO || next === OFF) return void homeStore.setSearch(next);
		const found = search?.models.find((m) => modelValue(m.provider.id, m.model) === next);
		if (found) void homeStore.setSearch({ provider: found.provider.id, model: found.model });
	};

	let line: string;
	if (!search) line = "Looking for a search model…";
	else if (choice === OFF) line = "Off: sites can't search with a model on this computer.";
	else if (chosenMissing && typeof choice === "object") {
		const service = ({ lmstudio: "LM Studio", ollama: "Ollama" } as Record<string, string>)[choice.provider] ?? choice.provider;
		line = `${searchModelName(choice.model)} isn't available now. Open ${service} and load it, or choose another.`;
	}
	else if (search.current) line = `Sites use ${searchModelName(search.current.model)} · ${search.current.provider.name}, on this computer.`;
	else line = "No search model on this computer yet. Load one in LM Studio or Ollama (nomic-embed-text, for example).";

	return (
		<Card size="2">
			<Flex direction="column" gap="3">
				<Flex direction="column" gap="1">
					<Text weight="bold">Search by meaning</Text>
					<Text size="2" color="gray">
						Some websites search their own pages by meaning, with a model on this computer. What you search stays here.
					</Text>
				</Flex>
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
								{chosenMissing && typeof choice === "object" && (
									<Select.Item value={value}>{searchModelName(choice.model)} (not available now)</Select.Item>
								)}
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
	);
}

/**
 * One of Your AIs: its name, the Default badge, a menu for the rare
 * actions (Make default, Check that it works, Remove) and its model,
 * folded. Only services say where they run.
 */
function AiRow({ ai, models, check }: { ai: YourAi; models: AgentModels | null; check?: TestResult | "running" }) {
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
					<AgentModelSelect
						models={models}
						showLabel={false}
						onChange={(id) => void (ai.default ? appStore.setModel(id) : homeStore.setAiModel(ai.id, id))}
					/>
				</Disclosure>
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
