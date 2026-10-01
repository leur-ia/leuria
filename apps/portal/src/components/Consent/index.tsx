import { type ReactNode, useEffect, useState } from "react";

import { type Answer, answer, start, storedAnswer } from "./analytics";
import styles from "./styles.module.css";

/**
 * "Can we count your visit?", until the reader answers. The footer's
 * "Visit counting" (`data-consent-open`) asks again.
 */
export default function Consent(): ReactNode {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const stored = storedAnswer();
		if (stored === "yes") start();
		else if (stored === null) setOpen(true);
		const onClick = (event: MouseEvent) => {
			if ((event.target as Element | null)?.closest?.("[data-consent-open]")) setOpen(true);
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);

	if (!open) return null;
	const reply = (value: Answer) => {
		answer(value);
		setOpen(false);
	};
	return (
		<div className={styles.consent} role="region" aria-label="Visit counting">
			<p>
				<strong>Can we count your visit?</strong> We'd use Google Analytics to see which pages help, and only if you say yes.{" "}
				<a href="https://leuria.eu/privacy-policy#this-website">Details</a>
			</p>
			<div className={styles.actions}>
				<button type="button" className="button button--secondary" onClick={() => reply("no")}>
					No thanks
				</button>
				<button type="button" className="button button--secondary" onClick={() => reply("yes")}>
					Yes, count it
				</button>
			</div>
		</div>
	);
}
