import chalk from "chalk";

import type argsTypes from "../cli/args.types.ts";
import platform from "../core/platform/index.ts";
import sessionFormat from "../core/session-manager/session-format.ts";
import errorsModule from "../utils/errors.ts";

const { writeError } = platform;
const { assertValidSessionId } = sessionFormat;
const { toErrorMessage } = errorsModule;

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

const sessionFlags = { validateForkFlags, validateSessionIdFlags };

export default sessionFlags;
