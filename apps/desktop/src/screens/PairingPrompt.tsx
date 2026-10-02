import { Icon, InkButton } from "@leuria/pearl";
import { Badge, Button, Callout, Dialog, Flex, Select, Text } from "@radix-ui/themes";
import { useStore } from "@sinuxjs/react";
import { useEffect, useState } from "react";

import { AiChoiceCard } from "../components/AiChoiceCard";
import { SiteSkills } from "../components/SiteSkills";
import { friendlyName, type PairingRequest, type Status } from "../engine";
import { costWords, needsSentence, verdictOf, verdictWords } from "../fit-words";
import { appStore } from "../stores/app.store";
import { pairingStore } from "../stores/pairing.store";

const DEFAULT = "default";
/** "Same as the AI" in the model list: a value no AI uses as a model id. */
const SAME_MODEL = "leuria:same-as-ai";

/**
 * A site asks to use the visitor's AI: Leuria's consent window. One
 * decision, two actions, and what the site can and can't do in plain words.
 * Which of Your AIs and which model will answer, what it costs, and a
 * better fit for what the site said it needs, when there is one.
 */
export function PairingPrompt({ request, agent }: { request: PairingRequest; agent?: Status["agent"] }) {
	// Only disables the buttons while the answer is sent.
	const [busy, setBusy] = useState(false);
	const host = new URL(request.origin).host;
	const insecure = request.origin.startsWith("http:") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(request.origin);
	const choice = useStore(pairingStore);
	// A new request starts from the defaults.
	useEffect(() => void pairingStore.open(request.requestId, request.needs), [request.requestId]);

	const others = choice.ais.filter((ai) => !ai.default);
	const picked = choice.agent ? choice.ais.find((ai) => ai.id === choice.agent) : undefined;
	const aiName = picked ? friendlyName(picked) : agent ? friendlyName(agent) : "your AI";
	const modelName = choice.model ? (choice.models?.options.find((m) => m.id === choice.model)?.name ?? choice.model) : undefined;
	const sameModel = choice.models?.options.find((m) => m.id === choice.models?.current)?.name;

	// What will answer, what it costs, and how it fits what the site said it needs.
	const defaultId = agent?.id ?? "";
	const agentId = choice.agent ?? defaultId;
	const current = choice.model ?? choice.models?.current;
	const currentName = choice.models?.options.find((m) => m.id === current)?.name;
	const fitAi = choice.fit?.ais.find((a) => a.id === agentId);
	const currentCost = fitAi?.models.find((m) => m.id === current)?.cost ?? fitAi?.cost;
	const declared = Boolean(choice.fit?.needs);
	const best = declared ? (choice.fit?.recommended ?? null) : null;
	const bestAi = best ? choice.ais.find((ai) => ai.id === best.agent) : undefined;
	const onBest = best !== null && best.agent === agentId && (best.model === null || best.model === current);

	const decide = (allow: boolean) => {
		setBusy(true);
		const picks = choice.requestId === request.requestId && (choice.agent || choice.model);
		void appStore
			.decide(
				request.requestId,
				allow,
				picks ? { agent: choice.agent, ...(choice.model ? { model: choice.model } : {}), aiName: modelName ? `${aiName} · ${modelName}` : aiName } : {},
			)
			.then(() => appStore.refresh())
			.finally(() => setBusy(false));
	};

	return (
		<Dialog.Root open onOpenChange={(open) => !open && !busy && decide(false)}>
			<Dialog.Content
				maxWidth="420px"
				size="3"
				aria-describedby="consent-can"
				// Focus the dialog, not a button: no ring suggesting a pre-chosen answer.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					(event.currentTarget as HTMLElement | null)?.focus();
				}}
			>
				<Flex direction="column" gap="4">
					<Badge color="gray" variant="soft" size="2" style={{ alignSelf: "flex-start" }}>
						<Icon name="globe" size={14} />
						{host}
					</Badge>
					<Dialog.Title size="5" mb="0">
						{request.app ?? host} wants to use your AI
					</Dialog.Title>
					<AiChoiceCard
						title={currentName ? `${aiName} · ${currentName}` : aiName}
						cost={costWords(currentCost, aiName)}
						verdict={declared ? verdictOf(choice.fit, agentId, current) : undefined}
						needs={needsSentence(request.needs)}
						busy={busy}
						suggestion={
							best && bestAi && !onBest
								? {
										title: `${friendlyName(bestAi)}${best.modelName ? ` · ${best.modelName}` : ""}`,
										cost: costWords(best.cost, friendlyName(bestAi)),
										onUse: () => void pairingStore.pick(best.isDefault ? null : best.agent, best.model),
									}
								: undefined
						}
					>
						{others.length > 0 && (
							<Flex direction="column" gap="1">
								<Text as="label" size="2" weight="medium">
									AI
								</Text>
								<Select.Root
									value={choice.agent ?? DEFAULT}
									disabled={busy}
									onValueChange={(value) => void pairingStore.pick(value === DEFAULT ? null : value, null)}
								>
									<Select.Trigger aria-label={`AI for ${host}`} style={{ width: "100%" }} />
									<Select.Content position="popper">
										<Select.Item value={DEFAULT}>
											Default · {agent ? friendlyName(agent) : "your AI"}
											{verdictWords(verdictOf(choice.fit, defaultId))}
										</Select.Item>
										<Select.Separator />
										{others.map((ai) => (
											<Select.Item key={ai.id} value={ai.id}>
												{friendlyName(ai)}
												{verdictWords(verdictOf(choice.fit, ai.id))}
											</Select.Item>
										))}
									</Select.Content>
								</Select.Root>
							</Flex>
						)}
						{choice.models && choice.models.options.length > 1 && (
							<Flex direction="column" gap="1">
								<Text as="label" size="2" weight="medium">
									Model
								</Text>
								<Select.Root
									value={choice.model ?? SAME_MODEL}
									disabled={busy}
									onValueChange={(value) => void pairingStore.pickModel(value === SAME_MODEL ? null : value)}
								>
									<Select.Trigger aria-label={`Model for ${host}`} style={{ width: "100%" }} />
									<Select.Content position="popper">
										<Select.Item value={SAME_MODEL}>{sameModel ? `Same as the AI · ${sameModel}` : "Same as the AI"}</Select.Item>
										<Select.Separator />
										{choice.models.options.map((m) => (
											<Select.Item key={m.id} value={m.id}>
												{m.name}
												{verdictWords(verdictOf(choice.fit, agentId, m.id))}
											</Select.Item>
										))}
									</Select.Content>
								</Select.Root>
							</Flex>
						)}
						<Text size="1" color="gray">
							You can change it later in Websites.
						</Text>
					</AiChoiceCard>
					<Flex direction="column" gap="3" id="consent-can">
						<Flex direction="column" gap="2">
							<span className="pearl-eyebrow">It can</span>
							<ul className="can-list">
								<li>
									<Icon name="check" />
									Ask your AI to answer you
								</li>
								<li>
									<Icon name="check" />
									Let your AI use this site's features to help you
								</li>
							</ul>
						</Flex>
						<Flex direction="column" gap="2">
							<span className="pearl-eyebrow">It can't</span>
							<ul className="can-list">
								<li>
									<Text color="gray">
										<Icon name="x" />
									</Text>
									See your files or run programs
								</li>
								<li>
									<Text color="gray">
										<Icon name="x" />
									</Text>
									See what you do on other websites
								</li>
							</ul>
						</Flex>
					</Flex>
					{request.skills && <SiteSkills list={request.skills.list} loading={request.skills.loading} />}
					{insecure && (
						<Callout.Root color="amber" size="1">
							<Callout.Icon>
								<Icon name="alert" />
							</Callout.Icon>
							<Callout.Text>This site doesn't use a secure connection.</Callout.Text>
						</Callout.Root>
					)}
					<Text size="1" color="gray">
						You can disconnect it at any time in Leuria.
					</Text>
					<Flex gap="3" justify="end" align="center">
						<Button variant="ghost" color="gray" size="3" disabled={busy} onClick={() => decide(false)}>
							Not now
						</Button>
						<InkButton loading={busy} onClick={() => decide(true)}>
							Allow
						</InkButton>
					</Flex>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	);
}
