import chalk from "chalk";

import type typesProviderTypes from "../core/extensions/types-provider.ts";
import argsPart1 from "./args-part1.ts";
import type argsTypes from "./args.types.ts";

const {
  parseArgsPart1,
  parseArgsPart10,
  parseArgsPart11,
  parseArgsPart12,
  parseArgsPart13,
  parseArgsPart2,
  parseArgsPart3,
  parseArgsPart4,
  parseArgsPart5,
  parseArgsPart6,
  parseArgsPart7,
  parseArgsPart8,
  parseArgsPart9,
} = argsPart1;

function parseArgs(args: string[]): argsTypes.Args {
  const result: argsTypes.Args = parseArgsPart8();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    const nextArg = args[i + 1];

    if (arg === "--") {
      parseArgsPart6(args, i, result);
      break;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--mode") {
      const mode = nextArg;
      if (mode === undefined || mode.startsWith("-")) {
        result.diagnostics.push({ message: "--mode requires text, json, or rpc", type: "error" });
        continue;
      }
      i++;
      if (mode !== "text" && mode !== "json" && mode !== "rpc") {
        result.diagnostics.push({
          message: `Invalid mode "${mode}". Valid values: text, json, rpc`,
          type: "error",
        });
        continue;
      }
      result.mode = mode;
    } else if (arg === "--continue" || arg === "-c") {
      result.continue = true;
    } else if (arg === "--resume" || arg === "-r") {
      result.resume = true;
    } else if (arg === "--provider" && nextArg !== undefined) {
      i++;
      result.provider = nextArg;
    } else if (arg === "--model" && nextArg !== undefined) {
      i++;
      result.model = nextArg;
    } else if (arg === "--api-key" && nextArg !== undefined) {
      i++;
      result.apiKey = nextArg;
    } else if (arg === "--system-prompt" && nextArg !== undefined) {
      i++;
      result.systemPrompt = nextArg;
    } else if (arg === "--append-system-prompt" && nextArg !== undefined) {
      i++;
      result.appendSystemPrompt = result.appendSystemPrompt ?? [];
      result.appendSystemPrompt.push(nextArg);
    } else if (arg === "--name" || arg === "-n") {
      i = parseArgsPart9(nextArg, result, i);
    } else if (arg === "--no-session") {
      result.noSession = true;
    } else if (arg === "--session" && nextArg !== undefined) {
      i++;
      result.session = nextArg;
    } else if (arg === "--session-id" && nextArg !== undefined) {
      i++;
      result.sessionId = nextArg;
    } else if (arg === "--fork" && nextArg !== undefined) {
      i++;
      result.fork = nextArg;
    } else if (arg === "--session-dir" && nextArg !== undefined) {
      i++;
      result.sessionDir = nextArg;
    } else if (arg === "--models" && nextArg !== undefined) {
      i = parseArgsPart11(i, result, nextArg);
    } else if (arg === "--no-tools" || arg === "-nt") {
      result.noTools = true;
    } else if (arg === "--no-builtin-tools" || arg === "-nbt") {
      result.noBuiltinTools = true;
    } else if (arg === "--orchestrator") {
      parseArgsPart12(result);
    } else if ((arg === "--tools" || arg === "-t") && nextArg !== undefined) {
      i = parseArgsPart3(i, nextArg, result, arg);
    } else if ((arg === "--exclude-tools" || arg === "-xt") && nextArg !== undefined) {
      i = parseArgsPart13(i, result, nextArg);
    } else if (arg === "--thinking" && nextArg !== undefined) {
      i = parseArgsPart4(i, nextArg, result);
    } else if (arg === "--print" || arg === "-p") {
      i = parseArgsPart5(result, nextArg, i);
    } else if (arg === "--export" && nextArg !== undefined) {
      i++;
      result.export = nextArg;
    } else if ((arg === "--extension" || arg === "-e") && nextArg !== undefined) {
      i++;
      result.extensions = result.extensions ?? [];
      result.extensions.push(nextArg);
    } else if (arg === "--no-extensions" || arg === "-ne") {
      result.noExtensions = true;
    } else if (arg === "--no-mcp") {
      result.noMcp = true;
    } else if (arg === "--skill" && nextArg !== undefined) {
      i++;
      result.skills = result.skills ?? [];
      result.skills.push(nextArg);
    } else if (arg === "--prompt-template" && nextArg !== undefined) {
      i++;
      result.promptTemplates = result.promptTemplates ?? [];
      result.promptTemplates.push(nextArg);
    } else if (arg === "--theme" && nextArg !== undefined) {
      i++;
      result.themes = result.themes ?? [];
      result.themes.push(nextArg);
    } else if (arg === "--use-theme") {
      i = parseArgsPart7(nextArg, result, i);
    } else if (arg === "--no-skills" || arg === "-ns") {
      result.noSkills = true;
    } else if (arg === "--no-prompt-templates" || arg === "-np") {
      result.noPromptTemplates = true;
    } else if (arg === "--no-themes") {
      result.noThemes = true;
    } else if (arg === "--no-context-files" || arg === "-nc") {
      result.noContextFiles = true;
    } else if (arg === "--list-models") {
      i = parseArgsPart10(nextArg, result, i);
    } else if (arg === "--tui-mode") {
      i = parseArgsPart1(nextArg, result, i);
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "--approve" || arg === "-a") {
      result.projectTrustOverride = true;
    } else if (arg === "--no-approve" || arg === "-na") {
      result.projectTrustOverride = false;
    } else if (arg === "--offline") {
      result.offline = true;
    } else if (arg.startsWith("@")) {
      result.fileArgs.push(arg.slice(1));
    } else if (arg.startsWith("--")) {
      i = parseArgsPart2(arg, nextArg, result, i);
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      result.diagnostics.push({ message: `Unknown option: ${arg}`, type: "error" });
    } else if (!arg.startsWith("-")) {
      result.messages.push(arg);
    }
  }

  return result;
}

function printHelpPart1(extensionFlags: typesProviderTypes.ExtensionFlag[] | undefined) {
  return extensionFlags !== undefined && extensionFlags.length > 0
    ? `\n${chalk.bold("Extension CLI Flags:")}\n${extensionFlags
        .map((flag) => {
          const value = flag.type === "string" ? " <value>" : "";
          const description = flag.description ?? `Registered by ${flag.extensionPath}`;
          return `  --${flag.name}${value}`.padEnd(30) + description;
        })
        .join("\n")}\n`
    : "";
}

const argsPart2 = {
  parseArgs,
  printHelpPart1,
};

export default argsPart2;
