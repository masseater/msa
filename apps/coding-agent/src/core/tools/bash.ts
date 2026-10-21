import type agentTypes from "@msa/agent-core/index.types";

import bashOperations from "./bash-operations.ts";
import bashRun from "./bash-run.ts";
import bashTypesModule from "./bash-types.ts";
import type bashTypes from "./bash.types.ts";
import bashModule from "./renderers/bash.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const { createLocalBashOperations } = bashOperations;
const { bashDescription, bashOutputSchema, bashSchema, bashToolSystemPromptContribution } =
  bashTypesModule;
const { shellExecute } = bashRun;
const { createShellRenderers } = bashModule;
const { configuredFactory, cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const createShellToolDefinitionImpl = (
  cwd: string,
  config: bashTypes.ShellToolConfig,
  options?: bashTypes.BashToolOptions,
): bashTypes.ShellToolDefinition => {
  const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
  const exposeSessionEnvironment = options?.exposeSessionEnvironment ?? true;
  return {
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description: bashDescription(config.shellName),
    execute: shellExecute(cwd, config, ops, options),
    label: config.label,
    name: config.name,
    outputSchema: bashOutputSchema,
    parameters: bashSchema,
    promptGuidelines:
      exposeSessionEnvironment && config.promptGuidelines !== undefined
        ? [...config.promptGuidelines]
        : undefined,
    promptSnippet: config.promptSnippet,
    ...createShellRenderers(config.prompt),
  };
};

const createShellToolDefinition: toolDefinitionWrapperTypes.ConfiguredFactory<
  bashTypes.ShellToolConfig,
  bashTypes.BashToolOptions,
  bashTypes.ShellToolDefinition
> = configuredFactory(createShellToolDefinitionImpl);

const bashToolConfig: bashTypes.ShellToolConfig = {
  label: "bash",
  name: "bash",
  prompt: "$",
  promptGuidelines: bashToolSystemPromptContribution.guidelines,
  promptSnippet: bashToolSystemPromptContribution.snippet,
  shellName: "bash",
  tempFilePrefix: "msa-bash",
};

const createBashToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  bashTypes.BashToolOptions,
  bashTypes.ShellToolDefinition
> = cwdFactory((cwd, options) => createShellToolDefinitionImpl(cwd, bashToolConfig, options));

const createBashTool: toolDefinitionWrapperTypes.CwdFactory<
  bashTypes.BashToolOptions,
  agentTypes.AgentTool<typeof bashSchema>
> = cwdFactory((cwd, options) => {
  const definition = createShellToolDefinitionImpl(cwd, bashToolConfig, options);
  const tool = wrapToolDefinition(definition);
  Object.assign(tool, {
    promptGuidelines: definition.promptGuidelines,
    promptSnippet: definition.promptSnippet,
  });
  return tool;
});

const bash = {
  bashToolSystemPromptContribution: bashTypesModule.bashToolSystemPromptContribution,
  createBashTool,
  createBashToolDefinition,
  createLocalBashOperations: bashOperations.createLocalBashOperations,
  createLocalShellOperations: bashOperations.createLocalShellOperations,
  createShellToolDefinition,
};

export default bash;
