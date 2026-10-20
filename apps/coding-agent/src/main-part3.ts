import chalk from "chalk";
import { Effect } from "effect";

import argsModule from "./cli/args.ts";
import AuthCommandError from "./cli/auth-command-error.ts";
import authCommand from "./cli/auth-command.ts";
import type authCommandTypes from "./cli/auth-command.types.ts";
import credentialPrint from "./cli/credential-print.ts";
import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import ModelRuntime from "./core/model-runtime.ts";
import platformModule from "./core/platform.ts";
import mainPart2 from "./main-part2.ts";

const { awaited, awaiting } = awaitingModule;
const {
  getAuthCommandName,
  getAuthCommandUsage,
  isAuthCommandHelp,
  parseAuthCommand,
  printAuthCommandHelp,
} = authCommand;
const { writeError } = platformModule;
const { parseArgs } = argsModule;
const { APP_NAME } = config;
const { resolveCredentialForPrint } = credentialPrint;
const { runAuthCommandPart1 } = mainPart2;

function runAuthCommand(args: string[]): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      if (isAuthCommandHelp(args)) {
        printAuthCommandHelp();
        return true;
      }

      let command: authCommandTypes.AuthCommand | undefined;
      try {
        command = parseAuthCommand(args);
      } catch (error) {
        const message =
          error instanceof AuthCommandError ? error.message : "Failed to parse auth command";
        writeError(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
        return true;
      }
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
      try {
        if (parsed.diagnostics.length > 0) {
          throw new AuthCommandError(
            parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
          );
        }
        if (command.kind !== "check") {
          const signal = AbortSignal.timeout(15_000);
          const modelRuntime = yield* awaited(
            ModelRuntime.create({ allowModelNetwork: false, signal }),
          );
          const credential = yield* awaited(
            resolveCredentialForPrint(
              parsed,
              modelRuntime,
              command.kind,
              command.minExpiryMs,
              signal,
            ),
          );
          process.stdout.write(`${credential}\n`);
          return true;
        }

        yield* runAuthCommandPart1(parsed, command);
      } catch (error) {
        const message =
          error instanceof AuthCommandError ? error.message : "Failed to resolve credential";
        writeError(chalk.red(`Error: ${message}`));
        process.exitCode = command.kind === "check" ? 2 : 1;
      }
      return true;
    }),
  );
}

const mainPart3 = {
  runAuthCommand,
};

export default mainPart3;
