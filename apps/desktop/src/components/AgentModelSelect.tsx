import { Flex, Select, Text } from "@radix-ui/themes";

import type { AgentModels } from "../engine";

/** Pick the model an agent uses: names in the list, the chosen one's description below. */
export function AgentModelSelect({
	models,
	onChange,
	disabled,
	showLabel = true,
}: {
	models: AgentModels;
	onChange: (id: string) => void;
	disabled?: boolean;
	/** Off inside a Disclosure, whose line already says "Model". */
	showLabel?: boolean;
}) {
	const current = models.options.find((m) => m.id === models.current);
	return (
		<Flex direction="column" gap="1">
			{showLabel && (
				<Text as="label" size="2" weight="medium">
					Model
				</Text>
			)}
			<Select.Root value={models.current} onValueChange={onChange} disabled={disabled}>
				<Select.Trigger aria-label="Model" placeholder="The AI's default" />
				<Select.Content position="popper">
					{models.options.map((m) => (
						<Select.Item key={m.id} value={m.id}>
							{m.name}
						</Select.Item>
					))}
				</Select.Content>
			</Select.Root>
			{current?.description && (
				<Text size="1" color="gray">
					{current.description}
				</Text>
			)}
		</Flex>
	);
}
