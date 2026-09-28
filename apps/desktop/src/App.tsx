import { BridgeStatus, Icon, InkButton, Logo, PearlSurface, Toast } from "@leuria/pearl";
import { Button, Callout, Card, Flex, Spinner, Text } from "@radix-ui/themes";
import { useStore } from "@sinuxjs/react";

import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { PairingPrompt } from "./screens/PairingPrompt";
import { appStore } from "./stores/app.store";

export function App() {
	const { view, error, status, request, toast, starting, stopped, checkingAgent } = useStore(appStore, (s) => ({
		view: s.view,
		error: s.error,
		status: s.status,
		request: s.requests[0],
		toast: s.toast,
		starting: s.starting,
		stopped: s.stopped,
		checkingAgent: s.starting !== "Starting Leuria…",
	}));

	return (
		<>
			{view === "onboarding" && <Onboarding />}
			{/* Starting and stopped are first impressions: the Pearl atmosphere, the mark, one line. */}
			{(view === "loading" || view === "error") && (
				<div className="start">
					<PearlSurface radius={0} padding="24px">
						<Flex direction="column" align="center" justify="center" gap="5" className="start-content">
							<Logo size={32} />
							{view === "loading" ? (
								<Flex direction="column" align="center" gap="4">
									<Flex gap="2" align="center" role="status">
										<Spinner size="2" />
										<Text size="3">{starting}</Text>
									</Flex>
									{/* Checking an AI can take a while: never a dead end. */}
									{checkingAgent && (
										<Button variant="ghost" color="gray" onClick={() => void appStore.skipCheck()}>
											Choose another AI
										</Button>
									)}
								</Flex>
							) : (
								<Card variant="surface" size="3" className="start-card">
									<Flex direction="column" gap="4">
										<Callout.Root color="red" role="alert">
											<Callout.Icon>
												<Icon name="alert" />
											</Callout.Icon>
											<Callout.Text>{error}</Callout.Text>
										</Callout.Root>
										<InkButton onClick={() => void appStore.recover().then(() => appStore.refresh())}>
											{stopped ? "Restart Leuria" : "Try again"}
										</InkButton>
									</Flex>
								</Card>
							)}
						</Flex>
					</PearlSurface>
				</div>
			)}
			{view === "home" && status && (
				<main className="app">
					<header className="app-header">
						<Logo size={22} />
						<BridgeStatus state="connected" size={1} />
					</header>
					<Home status={status} />
				</main>
			)}
			{request && <PairingPrompt request={request} agent={status?.agent} />}
			<Toast message={toast} onClose={() => void appStore.dismissToast()} />
		</>
	);
}
