import chalk from "chalk";
import { Effect } from "effect";

import type argsTypes from "./cli/args.types.ts";
import config from "./config.ts";
import type agentSessionServicesTypes from "./core/agent-session-services.types.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import type projectTrustTypes from "./core/project-trust.types.ts";
import interop from "./utils/interop.ts";

const { APP_NAME } = config;
const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { writeError } = platformModule;

const EXTENSION_LOAD_FAILURE_HINT = `Hint: Start without extensions using "${APP_NAME} -ne".`;

function readPipedStdin(): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (process.stdin.isTTY) {
        return undefined;
      }

      return yield* awaited(
        callbackPromise((resolve) => {
          let data = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => {
            data += chunk;
          });
          process.stdin.on("end", () => {
            resolve(data.trim() || undefined);
          });
          process.stdin.resume();
        }),
      );
    }),
  );
}

function reportDiagnostics(
  diagnostics: readonly agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    const color =
      diagnostic.type === "error"
        ? chalk.red
        : diagnostic.type === "warning"
          ? chalk.yellow
          : chalk.dim;
    const prefix =
      diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
    writeError(color(`${prefix}${diagnostic.message}`));
  }
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveAppMode(
  parsed: argsTypes.Args,
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): projectTrustTypes.AppMode {
  if (parsed.mode === "rpc") {
    return "rpc";
  }
  if (parsed.mode === "json") {
    return "json";
  }
  if (parsed.print === true || !stdinIsTTY || !stdoutIsTTY) {
    return "print";
  }
  return "interactive";
}

function toPrintOutputMode(appMode: projectTrustTypes.AppMode): Exclude<argsTypes.Mode, "rpc"> {
  return appMode === "json" ? "json" : "text";
}

function isPlainRuntimeMetadataCommand(parsed: argsTypes.Args): boolean {
  return (
    parsed.print !== true &&
    parsed.mode === undefined &&
    (parsed.help === true || parsed.listModels !== undefined)
  );
}

const mainPart1 = {
  EXTENSION_LOAD_FAILURE_HINT,
  isPlainRuntimeMetadataCommand,
  isTruthyEnvFlag,
  readPipedStdin,
  reportDiagnostics,
  resolveAppMode,
  toPrintOutputMode,
};

export default mainPart1;
