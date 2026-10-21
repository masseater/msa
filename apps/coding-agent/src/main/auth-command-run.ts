import chalk from "chalk";

import type argsTypes from "../cli/args.types.ts";
import AuthCommandError from "../cli/auth-command-error.ts";
import type authCommandTypes from "../cli/auth-command.types.ts";
import credentialPrint from "../cli/credential-print.ts";
import awaitingModule from "../core/awaiting.ts";
import ModelRuntime from "../core/model-runtime.ts";
import platformModule from "../core/platform.ts";
import authCheckRun from "./auth-check-run.ts";

const { resolveCredentialForPrint } = credentialPrint;
const { awaited } = awaitingModule;
const { writeError } = platformModule;
const { checkAuthAndPrint } = authCheckRun;

function* printCredential(
  parsed: argsTypes.Args,
  kind: Exclude<authCommandTypes.AuthCommand["kind"], "check">,
  minExpiryMs: authCommandTypes.AuthCommand["minExpiryMs"],
) {
  const signal = AbortSignal.timeout(15_000);
  const modelRuntime = yield* awaited(ModelRuntime.create({ allowModelNetwork: false, signal }));
  const credential = yield* awaited(
    resolveCredentialForPrint(parsed, modelRuntime, kind, minExpiryMs, signal),
  );
  process.stdout.write(`${credential}\n`);
}

function* runParsedAuthCommand(parsed: argsTypes.Args, command: authCommandTypes.AuthCommand) {
  try {
    if (parsed.diagnostics.length > 0) {
      throw new AuthCommandError(
        parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      );
    }
    if (command.kind === "check") {
      yield* checkAuthAndPrint(parsed, command);
    } else {
      yield* printCredential(parsed, command.kind, command.minExpiryMs);
    }
  } catch (error) {
    const message =
      error instanceof AuthCommandError ? error.message : "Failed to resolve credential";
    writeError(chalk.red(`Error: ${message}`));
    process.exitCode = command.kind === "check" ? 2 : 1;
  }
}

const authCommandRun = { runParsedAuthCommand };

export default authCommandRun;
