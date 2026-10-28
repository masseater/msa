import * as Effect from "effect/Effect";

import configModule from "../../config.ts";
import loginModule from "../../extensions/mcp/cli/login.ts";
import errorsModule from "../../utils/errors.ts";
import awaitingModule from "../awaiting.ts";
import platform from "../platform/index.ts";
import memoryServiceFactory from "./memory-service-factory.ts";
import type MemoryService from "./memory-service.ts";
import type memoryTypes from "./memory.types.ts";

const { APP_NAME } = configModule;
const { awaited, awaiting } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { writeError, writeLog } = platform;
const { waitForRedirectUrl } = loginModule;
const { openMemoryService } = memoryServiceFactory;

const DEFAULT_LOGIN_TIMEOUT_SECONDS = 300;
const STATUS_TIMEOUT_MS = 15_000;

const HELP = `Usage: ${APP_NAME} memory <command>

Long-term memory in sepiace.

Commands:
  status                  Show whether memory is on, signed in, and connected
  login [--timeout <s>]   Sign in to sepiace in the browser (default timeout ${DEFAULT_LOGIN_TIMEOUT_SECONDS}s)
  logout                  Remove the stored sepiace sign-in

Memory is turned on and off with memory.enabled in settings.json.`;

type MemoryCliOptions = memoryTypes.MemoryCliOptions;

function login(
  service: MemoryService,
  rest: readonly string[],
  options: MemoryCliOptions,
  log: (line: string) => void,
  error: (line: string) => void,
): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const timeoutIndex = rest.indexOf("--timeout");
      const timeout =
        timeoutIndex === -1 ? DEFAULT_LOGIN_TIMEOUT_SECONDS : Number(rest[timeoutIndex + 1]);
      const extra = rest.filter((_, index) => index !== timeoutIndex && index !== timeoutIndex + 1);
      if (!Number.isFinite(timeout) || timeout <= 0 || extra.length > 0) {
        error(`Usage: ${APP_NAME} memory login [--timeout <seconds>]`);
        return 1;
      }
      if (yield* awaited(service.client.connect())) {
        log("Already signed in to sepiace.");
        return 0;
      }
      const interactive = process.stdin.isTTY === true && options.connection?.openUrl === undefined;
      try {
        const note = yield* awaited(
          service.signIn(AbortSignal.timeout(timeout * 1000), {
            promptForRedirectUrl: (signal) => waitForRedirectUrl(signal, interactive),
            showAuthorizationUrl: (url) => log(`Sign in to sepiace in your browser:\n${url.href}`),
          }),
        );
        log("Signed in to sepiace.");
        if (note !== undefined) log(note);
        return 0;
      } catch (signInError) {
        error(toErrorMessage(signInError));
        return 1;
      }
    }),
  );
}

function runMemoryCli(args: readonly string[], options: MemoryCliOptions): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const log = options.log ?? ((line: string) => writeLog(line));
      const error = options.error ?? ((line: string) => writeError(line));
      const [command, ...rest] = args;
      if (command === undefined || command === "help" || args.includes("--help")) {
        log(HELP);
        return 0;
      }
      if (command !== "status" && command !== "login" && command !== "logout") {
        error(`Unknown memory command "${command}".\n${HELP}`);
        return 1;
      }
      const service = yield* awaited(
        openMemoryService(options.agentDir, options.cwd, options.connection),
      );
      try {
        if (command === "logout") {
          const removed = yield* awaited(service.signOut());
          log(removed ? "Signed out of sepiace." : "No sepiace sign-in was stored.");
          return 0;
        }
        if (!service.settings.enabled) {
          (command === "status" ? log : error)("Memory is off (settings: memory.enabled).");
          return command === "status" ? 0 : 1;
        }
        if (command === "login") return yield* awaited(login(service, rest, options, log, error));
        yield* awaited(service.client.ready(AbortSignal.timeout(STATUS_TIMEOUT_MS)));
        log(service.status(yield* awaited(service.legacyPending())));
        return 0;
      } finally {
        yield* awaited(service.client.close());
      }
    }),
  );
}

const memoryCli = { HELP, runMemoryCli };

export default memoryCli;
