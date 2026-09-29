import { PearlTheme } from "@leuria/pearl";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@leuria/pearl/styles.css";
import "./app.css";
import { App } from "./App";
import { bindLinks } from "./links";
import { appStore, bindEngineEvents } from "./stores/app.store";
import { bindHomeEvents } from "./stores/home.store";

bindEngineEvents();
bindHomeEvents();
bindLinks();
void appStore.refresh();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PearlTheme>
			<App />
		</PearlTheme>
	</StrictMode>,
);
