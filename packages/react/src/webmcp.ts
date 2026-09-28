import { exposeTools, type ToolDefinition } from "@leuria/client";
import { useEffect } from "react";

/**
 * Offer page tools to the browser's agents (WebMCP) while the component
 * is mounted. Pass a stable array (defined outside render, or memoized).
 */
export function useExposedTools(tools: ToolDefinition[]): void {
	useEffect(() => exposeTools(tools), [tools]);
}
