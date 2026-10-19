import type { AgentTool } from "@msa/agent-core";
import { Function as Fn } from "effect";

import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import type { ExtensionRunner } from "./runner.ts";
import type { RegisteredTool } from "./types.ts";

export const wrapRegisteredTool: {
  (runner: ExtensionRunner): (registeredTool: RegisteredTool) => AgentTool;
  (registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool;
} = Fn.dual(2, (registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool =>
  wrapToolDefinition(registeredTool.definition, (toolCallId, signal) =>
    runner.createToolContext(toolCallId, signal),
  ),
);

export const wrapRegisteredTools: {
  (runner: ExtensionRunner): (registeredTools: RegisteredTool[]) => AgentTool[];
  (registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[];
} = Fn.dual(2, (registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[] =>
  registeredTools.map((tool) => wrapRegisteredTool(tool, runner)),
);
