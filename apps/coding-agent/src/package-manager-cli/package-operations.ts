import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import type DefaultPackageManager from "../core/default-package-manager.ts";
import platform from "../core/platform/index.ts";
import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";
import selfUpdate from "./self-update.ts";

const { writeError, writeLog } = platform;
const { APP_NAME } = config;
const { awaited, awaiting } = awaitingModule;
const { performSelfUpdate } = selfUpdate;

function updateTargetIncludesSelf(target: packageManagerCliInternalTypes.UpdateTarget): boolean {
  return target.type === "all" || target.type === "self";
}

function updateTargetIncludesExtensions(
  target: packageManagerCliInternalTypes.UpdateTarget,
): boolean {
  return target.type === "all" || target.type === "extensions";
}

type Options = packageManagerCliInternalTypes.PackageCommandOptions;
type ConfiguredPackage = Awaited<
  ReturnType<DefaultPackageManager["configured"]["listConfiguredPackages"]>
>[number];

function installPackage(packageManager: DefaultPackageManager, source: string, local: boolean) {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(packageManager.operations.install.installAndPersist(source, { local }));
      writeLog(chalk.green(`Installed ${source}`));
    }),
  );
}

function removePackage(packageManager: DefaultPackageManager, source: string, local: boolean) {
  return Effect.runPromise(
    awaiting(function* () {
      const removed = yield* awaited(
        packageManager.operations.install.removeAndPersist(source, { local }),
      );
      if (!removed) {
        writeError(chalk.red(`No matching package found for ${source}`));
        process.exitCode = 1;
        return;
      }
      writeLog(chalk.green(`Removed ${source}`));
    }),
  );
}

function printPackage(pkg: ConfiguredPackage): void {
  writeLog(`  ${pkg.filtered ? `${pkg.source} (filtered)` : pkg.source}`);
  if (pkg.installedPath !== undefined && pkg.installedPath !== "") {
    writeLog(chalk.dim(`    ${pkg.installedPath}`));
  }
}

function listPackages(packageManager: DefaultPackageManager): Promise<void> {
  return packageManager.configured.listConfiguredPackages().then(printPackages);
}

function printPackages(configuredPackages: ConfiguredPackage[]): void {
  if (configuredPackages.length === 0) {
    writeLog(chalk.dim("No packages installed."));
    return;
  }
  const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
  const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");
  if (userPackages.length > 0) {
    writeLog(chalk.bold("User packages:"));
    for (const pkg of userPackages) printPackage(pkg);
  }
  if (projectPackages.length > 0) {
    if (userPackages.length > 0) writeLog();
    writeLog(chalk.bold("Project packages:"));
    for (const pkg of projectPackages) printPackage(pkg);
  }
}

function updatePackages(
  packageManager: DefaultPackageManager,
  options: Options,
  selfUpdateNpmCommand: string[] | undefined,
) {
  return Effect.runPromise(
    awaiting(function* () {
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
        yield* awaited(packageManager.operations.updates.update(updateSource));
        writeLog(
          chalk.green(
            updateSource !== undefined && updateSource !== ""
              ? `Updated ${updateSource}`
              : "Updated packages",
          ),
        );
      }
      if (updateTargetIncludesSelf(target)) {
        yield* performSelfUpdate(options.force, selfUpdateNpmCommand);
      }
    }),
  );
}

function runOperation(
  packageManager: DefaultPackageManager,
  options: Options,
  selfUpdateNpmCommand: string[] | undefined,
): Promise<void> {
  const source = options.source ?? "";
  switch (options.command) {
    case "install":
      return installPackage(packageManager, source, options.local);
    case "remove":
      return removePackage(packageManager, source, options.local);
    case "list":
      return listPackages(packageManager);
    case "update":
      return updatePackages(packageManager, options, selfUpdateNpmCommand);
  }
}

const packageOperations = { runOperation };

export default packageOperations;
