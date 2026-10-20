import { createInterface } from "node:readline/promises";

import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import errorsModule from "../../utils/errors.ts";
import interop from "../../utils/interop.ts";
import runtime from "./runtime.ts";

const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { McpSignInCancelledError } = runtime;
const { toErrorMessage } = errorsModule;

function loginPart1(
  error: (line: string) => void,
  signInError: unknown,
  name: string,
  timeoutMs: number,
) {
  error(
    signInError instanceof McpSignInCancelledError
      ? `Sign-in to MCP server "${name}" was cancelled or not completed within ${Math.round(timeoutMs / 1000)} seconds.`
      : `Sign-in to MCP server "${name}" failed: ${toErrorMessage(signInError)}`,
  );
  return 1;
}

function waitForRedirectUrl(
  signal: AbortSignal,
  interactive: boolean,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!interactive) {
        if (!signal.aborted)
          yield* awaited(
            callbackPromise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
          );
        return undefined;
      }
      const readline = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return yield* awaited(
          readline.question(
            "If the browser cannot reach this machine, paste the URL it was redirected to: ",
            {
              signal,
            },
          ),
        );
      } catch {
        return undefined;
      } finally {
        readline.close();
      }
    }),
  );
}

const cliPart4 = {
  loginPart1,
  waitForRedirectUrl,
};

export default cliPart4;
