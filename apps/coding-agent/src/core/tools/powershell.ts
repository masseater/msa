import { getPowerShellConfig } from "../../utils/shell.ts";
import {
  type BashOperations,
  type BashSpawnContext,
  type BashSpawnHook,
  type BashToolDetails,
  type BashToolInput,
  type BashToolOptions,
  createLocalShellOperations,
  createShellToolDefinition,
  type ShellToolConfig,
  type createBashTool,
} from "./bash.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

const UTF8_OUTPUT_PREFIX =
  "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n";

export const powershellToolSystemPromptContribution = {
  snippet: "Execute PowerShell commands",
  guidelines: [
    "You can inspect MSA_* environment variables for current model and session details.",
  ],
} as const;

export type PowerShellOperations = BashOperations;
export type PowerShellSpawnContext = BashSpawnContext;
export type PowerShellSpawnHook = BashSpawnHook;
export type PowerShellToolDetails = BashToolDetails;
export type PowerShellToolInput = BashToolInput;

export interface PowerShellToolOptions extends Pick<
  BashToolOptions,
  "operations" | "exposeSessionEnvironment" | "spawnHook"
> {}

export function createLocalPowerShellOperations(): PowerShellOperations {
  const operations = createLocalShellOperations("PowerShell", getPowerShellConfig);
  return {
    exec: (command, cwd, options) =>
      operations.exec(`${UTF8_OUTPUT_PREFIX}${command}`, cwd, options),
  };
}

const powershellToolConfig: ShellToolConfig = {
  name: "powershell",
  label: "powershell",
  shellName: "PowerShell",
  prompt: "PS>",
  promptSnippet: powershellToolSystemPromptContribution.snippet,
  promptGuidelines: powershellToolSystemPromptContribution.guidelines,
  tempFilePrefix: "msa-powershell",
};

export const createPowerShellToolDefinition: CwdFactory<
  PowerShellToolOptions,
  ReturnType<typeof createShellToolDefinition>
> = cwdFactory((cwd, options) =>
  createShellToolDefinition(cwd, powershellToolConfig, {
    ...options,
    operations: options?.operations ?? createLocalPowerShellOperations(),
  }),
);

export const createPowerShellTool: CwdFactory<
  PowerShellToolOptions,
  ReturnType<typeof createBashTool>
> = cwdFactory((cwd, options) => {
  const definition = createPowerShellToolDefinition(cwd, options);
  const tool = wrapToolDefinition(definition);
  Object.assign(tool, {
    promptSnippet: definition.promptSnippet,
    promptGuidelines: definition.promptGuidelines,
  });
  return tool;
});
