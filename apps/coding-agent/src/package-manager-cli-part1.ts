import chalk from "chalk";

import config from "./config.ts";
import platformModule from "./core/platform.ts";
import type settingsManagerTypes from "./core/settings-manager.types.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const { writeError, writeLog } = platformModule;
const { APP_NAME, CONFIG_DIR_NAME } = config;

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
      printPackageCommandHelpPart2();
      return;

    case "update":
      return printPackageCommandHelpPart1();

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

function printPackageCommandHelpPart2() {
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

function printPackageCommandHelpPart1(): void {
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

function parsePackageCommandPart8(
  command: string,
  local: boolean,
  invalidOption: string | undefined,
  arg: string,
) {
  if (command === "install" || command === "remove") {
    local = true;
  } else {
    invalidOption = invalidOption ?? arg;
  }
  return { invalidOption, local };
}

function parsePackageCommandPart7(
  source: string | undefined,
  invalidArgument: string | undefined,
  arg: string,
) {
  if (source !== undefined && source !== "") {
    invalidArgument = invalidArgument ?? arg;
  } else {
    source = arg;
  }
  return { invalidArgument, source };
}

function parsePackageCommandPart6(
  rest: string[],
  index: number,
  missingOptionValue: string | undefined,
  arg: string,
  extensionFlagSource: string | undefined,
  conflictingOptions: string | undefined,
) {
  const value = rest[index + 1];
  if (value === undefined || value === "" || value.startsWith("-")) {
    missingOptionValue = missingOptionValue ?? arg;
  } else if (extensionFlagSource !== undefined && extensionFlagSource !== "") {
    conflictingOptions = conflictingOptions ?? "--extension can only be provided once";
    index++;
  } else {
    extensionFlagSource = value;
    index++;
  }
  return { conflictingOptions, extensionFlagSource, index, missingOptionValue };
}

function parsePackageCommandPart5(rawCommand: string | undefined) {
  let command: packageManagerCliTypes.PackageCommand | undefined;
  if (rawCommand === "uninstall") {
    command = "remove";
  } else if (
    rawCommand === "install" ||
    rawCommand === "remove" ||
    rawCommand === "update" ||
    rawCommand === "list"
  ) {
    command = rawCommand;
  }
  return command;
}

function parsePackageCommandPart4() {
  let local = false;
  let force = false;
  let projectTrustOverride: boolean | undefined = undefined;
  let help = false;
  let invalidOption: string | undefined = undefined;
  let invalidArgument: string | undefined = undefined;
  let missingOptionValue: string | undefined = undefined;
  let conflictingOptions: string | undefined = undefined;
  let source: string | undefined = undefined;
  let selfFlag = false;
  let extensionsFlag = false;
  let modelsFlag = false;
  let allFlag = false;
  let extensionFlagSource: string | undefined = undefined;
  return {
    allFlag,
    conflictingOptions,
    extensionFlagSource,
    extensionsFlag,
    force,
    help,
    invalidArgument,
    invalidOption,
    local,
    missingOptionValue,
    modelsFlag,
    projectTrustOverride,
    selfFlag,
    source,
  };
}

function parsePackageCommandPart1(
  allFlag: boolean,
  selfFlag: boolean,
  extensionsFlag: boolean,
  modelsFlag: boolean,
  extensionFlagSource: string | undefined,
  conflictingOptions: string | undefined,
  source: string | undefined,
) {
  if (
    allFlag &&
    (selfFlag ||
      extensionsFlag ||
      modelsFlag ||
      (extensionFlagSource !== undefined && extensionFlagSource !== ""))
  ) {
    conflictingOptions =
      conflictingOptions ??
      "--all cannot be combined with --self, --extensions, --models, or --extension";
  }
  if (allFlag && source !== undefined && source !== "") {
    conflictingOptions = conflictingOptions ?? "--all cannot be combined with a positional source";
  }
  return conflictingOptions;
}

const packageManagerCliPart1 = {
  CONFIG_COMMAND_USAGE,
  getPackageCommandUsage,
  parsePackageCommandPart1,
  parsePackageCommandPart4,
  parsePackageCommandPart5,
  parsePackageCommandPart6,
  parsePackageCommandPart7,
  parsePackageCommandPart8,
  printConfigCommandHelp,
  printPackageCommandHelp,
  reportSettingsErrors,
};

export default packageManagerCliPart1;
