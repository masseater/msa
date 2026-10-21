import chalk from "chalk";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import type packageManagerCliTypes from "../package-manager-cli.types.ts";
import configResources from "./config-resources.ts";
import help from "./help.ts";
import trustedSettings from "./trusted-settings.ts";

const { getAgentDir, APP_NAME } = config;
const { writeError } = platform;
const { awaiting, awaited } = awaitingModule;
const { trustedSettingsManager } = trustedSettings;
const { selectPackageResources } = configResources;
const { CONFIG_COMMAND_USAGE, printConfigCommandHelp } = help;

function parseConfigArgs(
  rest: readonly string[],
): { local: boolean; projectTrustOverride: boolean | undefined } | undefined {
  let local = false;
  let projectTrustOverride: boolean | undefined;
  for (const arg of rest) {
    if (arg === "-l" || arg === "--local") {
      local = true;
    } else if (arg === "-a" || arg === "--approve") {
      projectTrustOverride = true;
    } else if (arg === "-na" || arg === "--no-approve") {
      projectTrustOverride = false;
    } else if (arg.startsWith("-")) {
      writeError(chalk.red(`Unknown option ${arg} for "config".`));
      writeError(chalk.dim(`Use "${APP_NAME} --help" or "${CONFIG_COMMAND_USAGE}".`));
      process.exitCode = 1;
      return undefined;
    } else {
      writeError(chalk.red(`Unexpected argument ${arg}.`));
      writeError(chalk.dim(`Usage: ${CONFIG_COMMAND_USAGE}`));
      process.exitCode = 1;
      return undefined;
    }
  }
  return { local, projectTrustOverride };
}

function handleConfigCommandImpl(
  args: string[],
  runtimeOptions: packageManagerCliTypes.PackageCommandRuntimeOptions = {},
): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      const [command, ...rest] = args;
      if (command !== "config") return false;
      if (rest.includes("-h") || rest.includes("--help")) {
        printConfigCommandHelp();
        return true;
      }
      const parsed = parseConfigArgs(rest);
      if (parsed === undefined) return true;
      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const settingsManager = yield* awaited(
        trustedSettingsManager(
          {
            agentDir,
            cwd,
            extensionFactories: runtimeOptions.extensionFactories,
            projectTrustOverride: parsed.projectTrustOverride,
          },
          { requested: parsed.local, target: "resource config" },
        ),
      );
      if (settingsManager === undefined) return true;
      yield* selectPackageResources(settingsManager, runtimeOptions, cwd, agentDir, parsed.local);
      process.exit(0);
    }),
  );
}

const handleConfigCommand: {
  (
    args: string[],
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): Promise<boolean>;
  (
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): (args: string[]) => Promise<boolean>;
} = dual((args: IArguments) => args.length >= 1, handleConfigCommandImpl);

const configCommand = { handleConfigCommand };

export default configCommand;
