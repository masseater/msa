import chalk from "chalk";
import { Effect } from "effect";

import argsModule from "../cli/args.ts";
import AuthCommandError from "../cli/auth-command-error.ts";
import authCommand from "../cli/auth-command.ts";
import type authCommandTypes from "../cli/auth-command.types.ts";
import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platformModule from "../core/platform.ts";
import authCommandRun from "./auth-command-run.ts";

const {
  getAuthCommandUsage,
  getAuthCommandName,
  parseAuthCommand,
  printAuthCommandHelp,
  isAuthCommandHelp,
} = authCommand;
const { APP_NAME } = config;
const { parseArgs } = argsModule;
const { writeError } = platformModule;
const { awaiting } = awaitingModule;
const { runParsedAuthCommand } = authCommandRun;

function parseCommandOrReport(args: string[]): authCommandTypes.AuthCommand | undefined | null {
  try {
    return parseAuthCommand(args);
  } catch (error) {
    const message =
      error instanceof AuthCommandError ? error.message : "Failed to parse auth command";
    writeError(chalk.red(`Error: ${message}`));
    process.exitCode = 1;
    return null;
  }
}

function runAuthCommand(args: string[]): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      if (isAuthCommandHelp(args)) {
        printAuthCommandHelp();
        return true;
      }
      const command = parseCommandOrReport(args);
      if (command === null) return true;
      if (command === undefined) return false;

      const parsed = parseArgs(command.args);
      if (parsed.unknownFlags.size > 0) {
        const option = parsed.unknownFlags.keys().next().value;
        writeError(
          chalk.red(`Unknown option --${option} for "${getAuthCommandName(command.kind)}".`),
        );
        writeError(
          chalk.dim(`Use "${APP_NAME} --help" or "${getAuthCommandUsage(command.kind)}".`),
        );
        process.exitCode = 1;
        return true;
      }
      yield* runParsedAuthCommand(parsed, command);
      return true;
    }),
  );
}

const runAuthCommandModule = { runAuthCommand };

export default runAuthCommandModule;
