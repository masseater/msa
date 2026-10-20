import shell from "../../utils/shell.ts";
import bash from "./bash.ts";
import type bashTypes from "./bash.types.ts";
import type powershellTypes from "./powershell.types.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const { createLocalShellOperations, createShellToolDefinition } = bash;
const { getPowerShellConfig } = shell;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const UTF8_OUTPUT_PREFIX =
  "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n";

const powershellToolSystemPromptContribution = {
  guidelines: [
    "You can inspect MSA_* environment variables for current model and session details.",
  ],
  snippet: "Execute PowerShell commands",
} as const;

function createLocalPowerShellOperations(): powershellTypes.PowerShellOperations {
  const operations = createLocalShellOperations("PowerShell", getPowerShellConfig);
  return {
    exec: (command, cwd, options) =>
      operations.exec(`${UTF8_OUTPUT_PREFIX}${command}`, cwd, options),
  };
}

const powershellToolConfig: bashTypes.ShellToolConfig = {
  label: "powershell",
  name: "powershell",
  prompt: "PS>",
  promptGuidelines: powershellToolSystemPromptContribution.guidelines,
  promptSnippet: powershellToolSystemPromptContribution.snippet,
  shellName: "PowerShell",
  tempFilePrefix: "msa-powershell",
};

const createPowerShellToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  powershellTypes.PowerShellToolOptions,
  ReturnType<typeof createShellToolDefinition>
> = cwdFactory((cwd, options) =>
  createShellToolDefinition(cwd, powershellToolConfig, {
    ...options,
    operations: options?.operations ?? createLocalPowerShellOperations(),
  }),
);

const createPowerShellTool: toolDefinitionWrapperTypes.CwdFactory<
  powershellTypes.PowerShellToolOptions,
  ReturnType<typeof bash.createBashTool>
> = cwdFactory((cwd, options) => {
  const definition = createPowerShellToolDefinition(cwd, options);
  const tool = wrapToolDefinition(definition);
  Object.assign(tool, {
    promptGuidelines: definition.promptGuidelines,
    promptSnippet: definition.promptSnippet,
  });
  return tool;
});

const powershell = {
  createLocalPowerShellOperations,
  createPowerShellTool,
  createPowerShellToolDefinition,
  powershellToolSystemPromptContribution,
};

export default powershell;
