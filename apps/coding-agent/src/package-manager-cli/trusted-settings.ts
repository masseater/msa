import chalk from "chalk";
import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";
import commandSettings from "./command-settings.ts";

const { writeError } = platform;
const { awaited, awaiting } = awaitingModule;
const { createCommandSettingsManager } = commandSettings;

function reportSettingsErrors(
  settingsManager: settingsManagerTypes.SettingsManager,
  context: string,
): void {
  const errors = settingsManager.drainErrors();
  for (const { scope, error } of errors) {
    writeError(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
    if (error.stack !== undefined && error.stack !== "") {
      writeError(chalk.dim(error.stack));
    }
  }
}

function reportProjectTrustWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    writeError(chalk.yellow(`Warning: ${warning}`));
  }
}

function trustedSettingsManager(
  options: packageManagerCliInternalTypes.CommandSettingsOptions,
  localWrite: { requested: boolean; target: string },
): Promise<settingsManagerTypes.SettingsManager | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const { settingsManager, projectTrustWarnings } = yield* awaited(
        createCommandSettingsManager(options),
      );
      reportProjectTrustWarnings(projectTrustWarnings);
      if (localWrite.requested && !settingsManager.isProjectTrusted()) {
        writeError(
          chalk.red(`Project is not trusted. Use --approve to modify local ${localWrite.target}.`),
        );
        process.exitCode = 1;
        return undefined;
      }
      return settingsManager;
    }),
  );
}

const trustedSettings = { reportSettingsErrors, trustedSettingsManager };

export default trustedSettings;
