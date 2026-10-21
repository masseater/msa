import chalk from "chalk";
import { Effect } from "effect";

import argsModule from "../cli/args.ts";
import type argsTypes from "../cli/args.types.ts";
import authCheck from "../cli/auth-check.ts";
import type authCheckTypes from "../cli/auth-check.types.ts";
import AuthCommandError from "../cli/auth-command-error.ts";
import authCommand from "../cli/auth-command.ts";
import type authCommandTypes from "../cli/auth-command.types.ts";
import credentialPrint from "../cli/credential-print.ts";
import config from "../config.ts";
import AuthStorage from "../core/auth-storage.ts";
import awaitingModule from "../core/awaiting.ts";
import ModelRuntime from "../core/model-runtime.ts";
import platformModule from "../core/platform.ts";
import ReadOnlyAuthStorage from "../core/read-only-auth-storage.ts";

const { resolveCredentialForPrint } = credentialPrint;
const {
  getAuthCommandUsage,
  getAuthCommandName,
  parseAuthCommand,
  printAuthCommandHelp,
  isAuthCommandHelp,
  validateAuthCommandArgs,
} = authCommand;
const { APP_NAME } = config;
const { parseArgs } = argsModule;
const { writeError } = platformModule;
const { awaiting, awaited } = awaitingModule;
const { getProviderCredential, checkProviderAuth, createAuthCheckModelRuntime } = authCheck;

function* checkAuthAndPrint(parsed: argsTypes.Args, command: authCommandTypes.AuthCommand) {
  const requestedAuth = validateAuthCommandArgs(parsed, command.kind);
  let result: authCheckTypes.AuthCheckResult;
  let credential: string | undefined;
  try {
    const credentials = command.noRefresh ? new ReadOnlyAuthStorage() : AuthStorage.create();
    const modelRuntime = yield* awaited(createAuthCheckModelRuntime(credentials));
    result = yield* awaited(
      checkProviderAuth(parsed, modelRuntime, { refresh: !command.noRefresh }),
    );
    if (command.credentials && result.status === "ready") {
      credential = yield* awaited(
        getProviderCredential(result.provider, modelRuntime, credentials, {
          refresh: !command.noRefresh,
        }),
      );
      if (credential === undefined || credential === "") {
        result = {
          provider: result.provider,
          reason: "credential_not_available",
          status: "not_ready",
        };
      }
    }
  } catch {
    result = {
      provider: requestedAuth.provider ?? requestedAuth.model!,
      reason: "invalid_state",
      status: "invalid",
    };
  }
  const output = command.json
    ? JSON.stringify({
        ...result,
        ...(credential !== undefined && credential !== "" ? { credentials: credential } : {}),
      })
    : (credential ?? result.status);
  process.stdout.write(`${output}\n`);
  process.exitCode = result.status === "ready" ? 0 : result.status === "not_ready" ? 1 : 2;
}

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

        yield* checkAuthAndPrint(parsed, command);
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

const runAuthCommandModule = { runAuthCommand };

export default runAuthCommandModule;
