import { createInterface } from "node:readline";

import chalk from "chalk";
import { Effect } from "effect";

import type argsTypes from "./cli/args.types.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import sessionManagerSupport from "./core/session-manager-support.ts";
import errorsModule from "./utils/errors.ts";
import interop from "./utils/interop.ts";

const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { writeError } = platformModule;
const { assertValidSessionId } = sessionManagerSupport;
const { toErrorMessage } = errorsModule;

function promptConfirm(message: string): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        callbackPromise((resolve) => {
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(`${message} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
          });
        }),
      );
    }),
  );
}

function validateForkFlags(parsed: argsTypes.Args): void {
  if (parsed.fork === undefined || parsed.fork === "") return;

  const conflictingFlags = [
    parsed.session !== undefined && parsed.session !== "" ? "--session" : undefined,
    parsed.continue === true ? "--continue" : undefined,
    parsed.resume === true ? "--resume" : undefined,
    parsed.noSession === true ? "--no-session" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    writeError(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
    process.exit(1);
  }
}

function validateSessionIdFlags(parsed: argsTypes.Args): void {
  if (parsed.sessionId === undefined) return;

  const conflictingFlags = [
    parsed.session !== undefined && parsed.session !== "" ? "--session" : undefined,
    parsed.continue === true ? "--continue" : undefined,
    parsed.resume === true ? "--resume" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    writeError(
      chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`),
    );
    process.exit(1);
  }

  try {
    assertValidSessionId(parsed.sessionId);
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    writeError(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

const mainPart5 = {
  promptConfirm,
  validateForkFlags,
  validateSessionIdFlags,
};

export default mainPart5;
