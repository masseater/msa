import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import packageManagerCliPart1 from "./package-manager-cli-part1.ts";
import packageManagerCliPart8 from "./package-manager-cli-part8.ts";
import packageManagerCliPart9 from "./package-manager-cli-part9.ts";
import packageManagerCliPart10 from "./package-manager-cli-part10.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError } = platformModule;
const { APP_NAME, getAgentDir } = config;
const { CONFIG_COMMAND_USAGE, printConfigCommandHelp } = packageManagerCliPart1;
const { createCommandSettingsManager } = packageManagerCliPart9;
const { reportProjectTrustWarnings } = packageManagerCliPart8;
const { handleConfigCommandImplPart1 } = packageManagerCliPart10;

function handleConfigCommandImpl(
  args: string[],
  runtimeOptions: packageManagerCliTypes.PackageCommandRuntimeOptions = {},
): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      const [command, ...rest] = args;
      if (command !== "config") {
        return false;
      }

      if (rest.includes("-h") || rest.includes("--help")) {
        printConfigCommandHelp();
        return true;
      }

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
          return true;
        } else {
          writeError(chalk.red(`Unexpected argument ${arg}.`));
          writeError(chalk.dim(`Usage: ${CONFIG_COMMAND_USAGE}`));
          process.exitCode = 1;
          return true;
        }
      }

      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const { settingsManager, projectTrustWarnings } = yield* awaited(
        createCommandSettingsManager({
          agentDir,
          cwd,
          extensionFactories: runtimeOptions.extensionFactories,
          projectTrustOverride,
        }),
      );
      reportProjectTrustWarnings(projectTrustWarnings);
      if (local && !settingsManager.isProjectTrusted()) {
        writeError(
          chalk.red("Project is not trusted. Use --approve to modify local resource config."),
        );
        process.exitCode = 1;
        return true;
      }
      yield* handleConfigCommandImplPart1(settingsManager, runtimeOptions, cwd, agentDir, local);

      process.exit(0);
    }),
  );
}

const packageManagerCliPart11 = {
  handleConfigCommandImpl,
};

export default packageManagerCliPart11;
