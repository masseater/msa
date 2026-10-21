import chalk from "chalk";

import config from "../config.ts";
import platformModule from "../core/platform.ts";
import type packageManagerCliTypes from "../package-manager-cli.types.ts";

const { CONFIG_DIR_NAME, APP_NAME } = config;
const { writeLog } = platformModule;

function getPackageCommandUsage(command: packageManagerCliTypes.PackageCommand): string {
  switch (command) {
    case "install":
      return `${APP_NAME} install <source> [-l] [--approve|--no-approve]`;
    case "remove":
      return `${APP_NAME} remove <source> [-l] [--approve|--no-approve]`;
    case "update":
      return `${APP_NAME} update [source|self|msa] [--self|--extensions|--models|--all] [--extension <source>] [--approve|--no-approve] [--force]`;
    case "list":
      return `${APP_NAME} list [--approve|--no-approve]`;
  }
}

const CONFIG_COMMAND_USAGE = `${APP_NAME} config [-l] [--approve|--no-approve]`;

function printConfigCommandHelp(): void {
  writeLog(`${chalk.bold("Usage:")}
  ${CONFIG_COMMAND_USAGE}

Open the resource configuration TUI to enable or disable package resources.
Without -l, starts in global settings (~/${CONFIG_DIR_NAME}/agent/settings.json).
Press Tab in the TUI to switch between global and project-local modes.

Options:
  -l, --local       Edit project overrides (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command with -l
  -na, --no-approve Ignore project-local files for this command with -l
`);
}

function printPackageCommandHelp(command: packageManagerCliTypes.PackageCommand): void {
  switch (command) {
    case "install":
      writeLog(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local       Install project-locally (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
      return;

    case "remove":
      printRemoveHelp();
      return;

    case "update":
      return printUpdateHelp();

    case "list":
      writeLog(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.

Options:
  -a, --approve      Trust project-local files for this command
  -na, --no-approve  Ignore project-local files for this command
`);
  }
}

function printUpdateHelp(): void {
  writeLog(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update msa, installed packages, or model catalogs.

Options:
  --self                  Update msa only (default when no target is given)
  --extensions            Update installed packages only
  --models                Refresh model catalogs only
  --all                   Update msa and installed packages
  --extension <source>    Update one package only
  -a, --approve           Trust project-local files for this command
  -na, --no-approve       Ignore project-local files for this command
  --force                 Reinstall msa even if the current version is latest

Short forms:
  ${APP_NAME} update                Update msa only
  ${APP_NAME} update --all          Update msa and all extensions
  ${APP_NAME} update --models       Refresh model catalogs only
  ${APP_NAME} update <source>       Update one package
  ${APP_NAME} update msa             Update msa only (self works as alias to msa)
`);
}

function printRemoveHelp() {
  writeLog(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.
Alias: ${APP_NAME} uninstall <source> [-l]

Options:
  -l, --local       Remove from project settings (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} remove npm:@foo/bar
  ${APP_NAME} uninstall npm:@foo/bar
`);
}

const help = {
  CONFIG_COMMAND_USAGE,
  getPackageCommandUsage,
  printConfigCommandHelp,
  printPackageCommandHelp,
};

export default help;
