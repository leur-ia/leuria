import { Checkbox, Flex, Select, Switch, Text } from "@radix-ui/themes";

import type { AgentModels, Cost, Fit, YourAi } from "../engine";
import { friendlyName } from "../engine";
import { Disclosure } from "./Disclosure";

/**
 * Dynamic selection: instead of one AI, a site gets, for each conversation,
 * the cheapest of Your AIs that fits what it declared it needs, among
 * those available right then. Stored as the site's agent id, with how far
 * it may go: `dynamic:free`, `dynamic:plan`, `dynamic` (paid too).
 */
export const DYNAMIC = "dynamic";

export function isDynamic(id: string | null | undefined): boolean {
	return id === DYNAMIC || (id?.startsWith(`${DYNAMIC}:`) ?? false);
}

export function dynamicCeiling(id: string): Cost {
	const upTo = id.split(":")[1];
	return upTo === "free" || upTo === "plan" ? upTo : "paid";
}

export function dynamicId(upTo: Cost): string {
	return upTo === "paid" ? DYNAMIC : `${DYNAMIC}:${upTo}`;
}

export const DYNAMIC_WORDS = "Dynamic selection";

const CEILINGS: Array<{ value: Cost; words: string }> = [
	{ value: "free", words: "Only AIs on this computer" },
	{ value: "plan", words: "Also AIs on your plans" },
	{ value: "paid", words: "Also AIs charged per use" },
];

/** "Dynamic selection · Claude · Sonnet 5": what the site would get right now. */
export function dynamicTitle(fit: Fit | null, ais: YourAi[]): string {
	const best = fit?.recommended;
	const ai = best ? ais.find((a) => a.id === best.agent) : undefined;
	if (!best || !ai) return DYNAMIC_WORDS;
	return `${DYNAMIC_WORDS} · ${friendlyName(ai)}${best.modelName ? ` · ${best.modelName}` : ""}`;
}

/** How far dynamic selection may go, for one site. */
export function CeilingSelect({ id, host, disabled, onChange }: { id: string; host: string; disabled?: boolean; onChange: (id: string) => void }) {
	return (
		<Flex direction="column" gap="1">
			<Text as="label" size="2" weight="medium">
				Choose among
			</Text>
			<Select.Root value={dynamicCeiling(id)} disabled={disabled} onValueChange={(value) => onChange(dynamicId(value as Cost))}>
				<Select.Trigger aria-label={`How far dynamic selection may go for ${host}`} style={{ width: "100%" }} />
				<Select.Content position="popper">
					{CEILINGS.map((c) => (
						<Select.Item key={c.value} value={c.value}>
							{c.words}
						</Select.Item>
					))}
				</Select.Content>
			</Select.Root>
			<Text size="1" color="gray">
				Each conversation starts on the lightest of these that is enough for this site.
			</Text>
		</Flex>
	);
}

/** How an AI or one of its models is named in the off list (the engine's `dynamicKey`). */
export function dynamicKey(agent: string, model?: string): string {
	return model ? `${agent}@${model}` : agent;
}

/**
 * On one of Your AIs: whether dynamic selection may use it, and which of
 * its models. Everything is in until the visitor leaves it out.
 */
export function DynamicMembership({ ai, models, off, onChange }: { ai: { id: string; name: string }; models: AgentModels | null; off: string[]; onChange: (model: string | null, on: boolean) => void }) {
	const aiOn = !off.includes(ai.id);
	const options = models?.options ?? [];
	const modelsOn = options.filter((m) => !off.includes(dynamicKey(ai.id, m.id))).length;
	return (
		<Flex direction="column" gap="2">
			<Text as="label" size="2">
				<Flex gap="2" align="center">
					<Switch size="1" checked={aiOn} onCheckedChange={(on) => onChange(null, on)} aria-label={`Include ${ai.name} in dynamic selection`} />
					Include in dynamic selection
				</Flex>
			</Text>
			{aiOn && options.length > 1 && (
				<Disclosure label="Models it may pick" value={modelsOn === options.length ? "All" : `${modelsOn} of ${options.length}`}>
					<Flex direction="column" gap="2">
						{options.map((m) => (
							<Text as="label" size="2" key={m.id}>
								<Flex gap="2" align="center">
									<Checkbox size="1" checked={!off.includes(dynamicKey(ai.id, m.id))} onCheckedChange={(on) => onChange(m.id, on === true)} />
									{m.name}
								</Flex>
							</Text>
						))}
					</Flex>
				</Disclosure>
			)}
		</Flex>
	);
}
