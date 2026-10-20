import type agentTypes from "@msa/agent-core/index.types";
import { Function as Fn } from "effect";

import toolDefinitionWrapper from "../tools/tool-definition-wrapper.ts";
import type runnerTypes from "./runner.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { wrapToolDefinition } = toolDefinitionWrapper;

const wrapRegisteredTool: {
  (
    runner: runnerTypes.ExtensionRunner,
  ): (registeredTool: extensionsTypesTypes.RegisteredTool) => agentTypes.AgentTool;
  (
    registeredTool: extensionsTypesTypes.RegisteredTool,
    runner: runnerTypes.ExtensionRunner,
  ): agentTypes.AgentTool;
} = Fn.dual(
  2,
  (
    registeredTool: extensionsTypesTypes.RegisteredTool,
    runner: runnerTypes.ExtensionRunner,
  ): agentTypes.AgentTool =>
    wrapToolDefinition(registeredTool.definition, (toolCallId, signal) =>
      runner.createToolContext(toolCallId, signal),
    ),
);

const wrapRegisteredTools: {
  (
    runner: runnerTypes.ExtensionRunner,
  ): (registeredTools: extensionsTypesTypes.RegisteredTool[]) => agentTypes.AgentTool[];
  (
    registeredTools: extensionsTypesTypes.RegisteredTool[],
    runner: runnerTypes.ExtensionRunner,
  ): agentTypes.AgentTool[];
} = Fn.dual(
  2,
  (
    registeredTools: extensionsTypesTypes.RegisteredTool[],
    runner: runnerTypes.ExtensionRunner,
  ): agentTypes.AgentTool[] => registeredTools.map((tool) => wrapRegisteredTool(tool, runner)),
);

const wrapper = {
  wrapRegisteredTool,
  wrapRegisteredTools,
};

export default wrapper;
