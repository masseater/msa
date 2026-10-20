import type agentTypes from "@msa/agent-core/index.types";
import { Function as Fn } from "effect";

import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import type { ExtensionRunner } from "./runner.ts";
import type { RegisteredTool } from "./types.ts";

export const wrapRegisteredTool: {
  (runner: ExtensionRunner): (registeredTool: RegisteredTool) => agentTypes.AgentTool;
  (registeredTool: RegisteredTool, runner: ExtensionRunner): agentTypes.AgentTool;
} = Fn.dual(2, (registeredTool: RegisteredTool, runner: ExtensionRunner): agentTypes.AgentTool =>
  wrapToolDefinition(registeredTool.definition, (toolCallId, signal) =>
    runner.createToolContext(toolCallId, signal),
  ),
);

export const wrapRegisteredTools: {
  (runner: ExtensionRunner): (registeredTools: RegisteredTool[]) => agentTypes.AgentTool[];
  (registeredTools: RegisteredTool[], runner: ExtensionRunner): agentTypes.AgentTool[];
} = Fn.dual(
  2,
  (registeredTools: RegisteredTool[], runner: ExtensionRunner): agentTypes.AgentTool[] =>
    registeredTools.map((tool) => wrapRegisteredTool(tool, runner)),
);
