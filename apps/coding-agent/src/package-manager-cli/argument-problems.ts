import chalk from "chalk";

import config from "../config.ts";
import platformModule from "../core/platform.ts";
import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";
import help from "./help.ts";

const { writeError } = platformModule;
const { APP_NAME } = config;
const { getPackageCommandUsage } = help;

type Options = packageManagerCliInternalTypes.PackageCommandOptions;

function usageError(options: Options, message: string): true {
  writeError(chalk.red(message));
  writeError(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
  process.exitCode = 1;
  return true;
}

function reportArgumentProblem(options: Options): boolean {
  if (options.invalidOption !== undefined && options.invalidOption !== "") {
    writeError(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
    writeError(
      chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`),
    );
    process.exitCode = 1;
    return true;
  }
  if (options.missingOptionValue !== undefined && options.missingOptionValue !== "") {
    return usageError(options, `Missing value for ${options.missingOptionValue}.`);
  }
  if (options.invalidArgument !== undefined && options.invalidArgument !== "") {
    return usageError(options, `Unexpected argument ${options.invalidArgument}.`);
  }
  if (options.conflictingOptions !== undefined && options.conflictingOptions !== "") {
    return usageError(options, options.conflictingOptions);
  }
  const needsSource = options.command === "install" || options.command === "remove";
  if (needsSource && (options.source === undefined || options.source === "")) {
    return usageError(options, `Missing ${options.command} source.`);
  }
  return false;
}

const argumentProblems = { reportArgumentProblem };

export default argumentProblems;
