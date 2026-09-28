// Leuria's web components in JSX.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type LeuriaElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			"leuria-ai-status": LeuriaElementProps;
			"leuria-connect-button": LeuriaElementProps;
		}
	}
}
