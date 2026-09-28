import { Icon } from "@leuria/pearl";
import { Button, Card, Flex, Separator, Text } from "@radix-ui/themes";
import { type ReactNode, useState } from "react";

import type { Verdict } from "../engine";

const VERDICT: Record<Verdict, { icon: "check" | "alert"; words: string; tone: "live" | "pending" | "blocked" }> = {
	fits: { icon: "check", words: "Right for this site", tone: "live" },
	more: { icon: "alert", words: "More than this site needs", tone: "pending" },
	short: { icon: "alert", words: "May struggle with this site", tone: "blocked" },
};

/**
 * What will answer a site, in one place: the AI and model, what it costs,
 * and whether it fits what the site said it needs. A better fit, when
 * there is one, is suggested below; the visitor's choice stays theirs.
 */
export function AiChoiceCard({
	title,
	cost,
	verdict,
	suggestion,
	needs,
	busy,
	children,
}: {
	/** "Claude · Opus 5.5". */
	title: string;
	/** "Uses your Claude plan". */
	cost?: string;
	/** Only when the site said what it needs. */
	verdict?: Verdict;
	/** A better fit, one click away. */
	suggestion?: { title: string; cost?: string; onUse: () => void };
	/** "This site does quick tasks with its own tools." */
	needs?: string;
	busy?: boolean;
	/** The full choice, shown with Change. */
	children: ReactNode;
}) {
	// UI only: whether the full choice is open.
	const [changing, setChanging] = useState(false);
	const fit = verdict ? VERDICT[verdict] : undefined;
	return (
		<Flex direction="column" gap="2">
			<span className="pearl-eyebrow">Answers with</span>
			<Card size="1">
				<Flex direction="column" gap="2">
					<Flex align="start" gap="3">
						<Flex direction="column" gap="1" flexGrow="1" minWidth="0">
							<Text size="2" weight="bold" truncate>
								{title}
							</Text>
							{cost && (
								<Text size="1" color="gray">
									{cost}
								</Text>
							)}
							{fit && (
								<Text size="1" weight="medium" className={`fit fit-${fit.tone}`}>
									<Icon name={fit.icon} size={14} />
									{fit.words}
								</Text>
							)}
						</Flex>
						<Button variant="ghost" size="1" disabled={busy} aria-expanded={changing} onClick={() => setChanging(!changing)}>
							{changing ? "Done" : "Change"}
						</Button>
					</Flex>
					{changing && <div className="ai-choice-change">{children}</div>}
					{suggestion && !changing && (
						<>
							<Separator size="4" />
							<Flex align="center" gap="3">
								<Flex direction="column" gap="1" flexGrow="1" minWidth="0">
									<Text size="1" color="gray">
										Better fit
									</Text>
									<Text size="2" weight="medium" truncate>
										{suggestion.title}
									</Text>
									{suggestion.cost && (
										<Text size="1" color="gray">
											{suggestion.cost}
										</Text>
									)}
								</Flex>
								<Button variant="soft" size="1" disabled={busy} onClick={suggestion.onUse}>
									Use it
								</Button>
							</Flex>
						</>
					)}
				</Flex>
			</Card>
			{needs && (
				<Text size="1" color="gray">
					{needs}
				</Text>
			)}
		</Flex>
	);
}
