import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import DefaultPackageManager from "../core/default-package-manager.ts";
import platform from "../core/platform/index.ts";
import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";
import type packageManagerCliTypes from "../package-manager-cli.types.ts";
import packageOperations from "./package-operations.ts";

const { writeError } = platform;
const { getAgentDir } = config;
const { awaited, awaiting } = awaitingModule;
const { runOperation } = packageOperations;

import trustedSettings from "./trusted-settings.ts";

const { reportSettingsErrors, trustedSettingsManager } = trustedSettings;

type Options = packageManagerCliInternalTypes.PackageCommandOptions;

function runWithPackageManager(
  options: Options,
  runtimeOptions: packageManagerCliTypes.PackageCommandRuntimeOptions,
) {
  return Effect.runPromise(
    awaiting(function* () {
      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const settingsManager = yield* awaited(
        trustedSettingsManager(
          {
            agentDir,
            cwd,
            extensionFactories: runtimeOptions.extensionFactories,
            projectTrustOverride: options.projectTrustOverride,
            useSavedProjectTrustOnly: options.command === "update",
          },
          {
            requested:
              (options.command === "install" || options.command === "remove") && options.local,
            target: "package config",
          },
        ),
      );
      if (settingsManager === undefined) return;
      reportSettingsErrors(settingsManager, "package command");
      const packageManager = new DefaultPackageManager({ agentDir, cwd, settingsManager });
      packageManager.progress.setProgressCallback((event) => {
        if (event.type === "start") process.stdout.write(chalk.dim(`${event.message}\n`));
      });
      try {
        yield* awaited(
          runOperation(packageManager, options, settingsManager.getGlobalSettings().npmCommand),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown package command error";
        writeError(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    }),
  );
}

const packageRun = { runWithPackageManager };

export default packageRun;
