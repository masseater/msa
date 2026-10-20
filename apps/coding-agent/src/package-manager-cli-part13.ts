import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import DefaultPackageManager from "./core/default-package-manager.ts";
import platformModule from "./core/platform.ts";
import packageManagerCliPart1 from "./package-manager-cli-part1.ts";
import packageManagerCliPart3 from "./package-manager-cli-part3.ts";
import packageManagerCliPart4 from "./package-manager-cli-part4.ts";
import packageManagerCliPart7 from "./package-manager-cli-part7.ts";
import packageManagerCliPart8 from "./package-manager-cli-part8.ts";
import packageManagerCliPart9 from "./package-manager-cli-part9.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platformModule;
const { APP_NAME, getAgentDir } = config;
const { parsePackageCommand, updateTargetIncludesExtensions, updateTargetIncludesSelf } =
  packageManagerCliPart3;
const { getPackageCommandUsage, printPackageCommandHelp, reportSettingsErrors } =
  packageManagerCliPart1;
const { refreshModelCatalogs } = packageManagerCliPart4;
const { createCommandSettingsManager } = packageManagerCliPart9;
const { reportProjectTrustWarnings } = packageManagerCliPart8;
const { performSelfUpdate } = packageManagerCliPart7;

function handlePackageCommandImpl(
  args: string[],
  runtimeOptions: packageManagerCliTypes.PackageCommandRuntimeOptions = {},
): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      const options = parsePackageCommand(args);
      if (options === undefined) {
        return false;
      }

      if (options.help) {
        printPackageCommandHelp(options.command);
        return true;
      }

      if (options.invalidOption !== undefined && options.invalidOption !== "") {
        writeError(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
        writeError(
          chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`),
        );
        process.exitCode = 1;
        return true;
      }

      if (options.missingOptionValue !== undefined && options.missingOptionValue !== "") {
        writeError(chalk.red(`Missing value for ${options.missingOptionValue}.`));
        writeError(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
      }

      if (options.invalidArgument !== undefined && options.invalidArgument !== "") {
        writeError(chalk.red(`Unexpected argument ${options.invalidArgument}.`));
        writeError(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
      }

      if (options.conflictingOptions !== undefined && options.conflictingOptions !== "") {
        writeError(chalk.red(options.conflictingOptions));
        writeError(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
      }

      const source = options.source;
      if (
        (options.command === "install" || options.command === "remove") &&
        (source === undefined || source === "")
      ) {
        writeError(chalk.red(`Missing ${options.command} source.`));
        writeError(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
      }

      if (options.command === "update" && options.updateTarget?.type === "models") {
        try {
          yield* awaited(refreshModelCatalogs(getAgentDir()));
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown model catalog refresh error";
          writeError(chalk.red(`Error: ${message}`));
          process.exitCode = 1;
        }
        return true;
      }

      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const writesProjectPackageConfig =
        (options.command === "install" || options.command === "remove") && options.local;
      const { settingsManager, projectTrustWarnings } = yield* awaited(
        createCommandSettingsManager({
          agentDir,
          cwd,
          extensionFactories: runtimeOptions.extensionFactories,
          projectTrustOverride: options.projectTrustOverride,
          useSavedProjectTrustOnly: options.command === "update",
        }),
      );
      reportProjectTrustWarnings(projectTrustWarnings);
      if (!settingsManager.isProjectTrusted() && writesProjectPackageConfig) {
        writeError(
          chalk.red("Project is not trusted. Use --approve to modify local package config."),
        );
        process.exitCode = 1;
        return true;
      }
      reportSettingsErrors(settingsManager, "package command");
      const selfUpdateNpmCommand = settingsManager.getGlobalSettings().npmCommand;

      const packageManager = new DefaultPackageManager({ agentDir, cwd, settingsManager });

      packageManager.setProgressCallback((event) => {
        if (event.type === "start") {
          process.stdout.write(chalk.dim(`${event.message}\n`));
        }
      });

      try {
        switch (options.command) {
          case "install":
            yield* awaited(packageManager.installAndPersist(source!, { local: options.local }));
            writeLog(chalk.green(`Installed ${source}`));
            return true;

          case "remove": {
            const removed = yield* awaited(
              packageManager.removeAndPersist(source!, { local: options.local }),
            );
            if (!removed) {
              writeError(chalk.red(`No matching package found for ${source}`));
              process.exitCode = 1;
              return true;
            }
            writeLog(chalk.green(`Removed ${source}`));
            return true;
          }

          case "list": {
            const configuredPackages = packageManager.listConfiguredPackages();
            const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
            const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");

            if (configuredPackages.length === 0) {
              writeLog(chalk.dim("No packages installed."));
              return true;
            }

            const formatPackage = (pkg: (typeof configuredPackages)[number]) => {
              const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
              writeLog(`  ${display}`);
              if (pkg.installedPath !== undefined && pkg.installedPath !== "") {
                writeLog(chalk.dim(`    ${pkg.installedPath}`));
              }
            };

            if (userPackages.length > 0) {
              writeLog(chalk.bold("User packages:"));
              for (const pkg of userPackages) {
                formatPackage(pkg);
              }
            }

            if (projectPackages.length > 0) {
              if (userPackages.length > 0) writeLog();
              writeLog(chalk.bold("Project packages:"));
              for (const pkg of projectPackages) {
                formatPackage(pkg);
              }
            }

            return true;
          }

          case "update": {
            const target = options.updateTarget ?? { type: "self" };
            if (options.showExtensionsSkippedNote) {
              writeLog(
                chalk.dim(
                  `Extensions are skipped. Run ${APP_NAME} update --extensions to update extensions.`,
                ),
              );
            }
            if (updateTargetIncludesExtensions(target)) {
              const updateSource = target.type === "extensions" ? target.source : undefined;
              yield* awaited(packageManager.update(updateSource));
              if (updateSource !== undefined && updateSource !== "") {
                writeLog(chalk.green(`Updated ${updateSource}`));
              } else {
                writeLog(chalk.green("Updated packages"));
              }
            }
            if (updateTargetIncludesSelf(target)) {
              yield* performSelfUpdate(options.force, selfUpdateNpmCommand);
            }
            return true;
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown package command error";
        writeError(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
        return true;
      }
    }),
  );
}

const packageManagerCliPart13 = {
  handlePackageCommandImpl,
};

export default packageManagerCliPart13;
