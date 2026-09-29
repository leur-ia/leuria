import { Badge, Flex, Text } from "@radix-ui/themes";

import type { SkillInfo } from "../engine";
import { Disclosure } from "./Disclosure";

/** Skills added in the last week are marked new. */
const NEW_FOR_MS = 7 * 24 * 60 * 60_000;

/** "size-guide" → "Size guide". */
export function skillTitle(name: string): string {
	const words = name.replace(/-/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The skills a site gives the visitor's AI: one sentence that says so,
 * and the list under "See details" (what each is for, and where it comes
 * from). Nothing when the site has none.
 */
export function SiteSkills({ list, loading = false }: { list: SkillInfo[]; loading?: boolean }) {
	if (loading) {
		return (
			<Text size="2" color="gray">
				Checking the skills this site uses to guide your AI…
			</Text>
		);
	}
	if (!list.length) return null;
	const fresh = list.filter((s) => s.addedAt && Date.now() - Date.parse(s.addedAt) < NEW_FOR_MS).length;
	return (
		<Flex direction="column" gap="1">
			<Text size="2">This site uses {list.length === 1 ? "1 skill" : `${list.length} skills`} to guide your AI.</Text>
			<Disclosure label="See details" value={fresh ? `${fresh} new` : undefined}>
				<ul className="skill-list">
					{list.map((skill) => (
						<li key={skill.name}>
							<Flex align="center" gap="2">
								<Text size="2" weight="medium">
									{skillTitle(skill.name)}
								</Text>
								{skill.addedAt && Date.now() - Date.parse(skill.addedAt) < NEW_FOR_MS && (
									<Badge color="gray" variant="soft" size="1">
										New
									</Badge>
								)}
							</Flex>
							<Text as="p" size="2" color="gray">
								{skill.description}
							</Text>
							<Text as="p" size="1" color="gray">
								{skill.shared ? `Shared skill · ${skill.source}` : `From ${skill.source}`}
							</Text>
						</li>
					))}
				</ul>
			</Disclosure>
		</Flex>
	);
}
