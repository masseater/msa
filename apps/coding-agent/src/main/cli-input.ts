import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";
import { Effect } from "effect";

import argsModule from "../cli/args.ts";
import type argsTypes from "../cli/args.types.ts";
import fileProcessor from "../cli/file-processor.ts";
import initialMessageModule from "../cli/initial-message.ts";
import config from "../config.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import awaitingModule from "../core/awaiting.ts";
import exportHtml from "../core/export-html/index.ts";
import outputGuard from "../core/output-guard.ts";
import platformModule from "../core/platform.ts";
import type projectTrustTypes from "../core/project-trust.types.ts";
import timings from "../core/timings.ts";
import interop from "../utils/interop.ts";
import pathsModule from "../utils/paths.ts";
import sessionSetup from "./session-setup.ts";

const { takeOverStdout } = outputGuard;
const { exportFromFile } = exportHtml;
const { VERSION, APP_NAME } = config;
const { writeLog, writeError } = platformModule;
const { time } = timings;
const { parseArgs } = argsModule;
const { processFileArguments } = fileProcessor;
const { buildInitialMessage } = initialMessageModule;
const { resolvePath, isLocalPath } = pathsModule;
const { callbackPromise } = interop;
const { awaited, awaiting } = awaitingModule;
const { validateSessionIdFlags, validateForkFlags } = sessionSetup;

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

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
  return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

function prepareInitialMessage(
  parsed: argsTypes.Args,
  stdinContent?: string,
): Promise<{
  initialMessage?: string | undefined;
  initialImages?: aiTypes.ImageContent[] | undefined;
}> {
  return Effect.runPromise(
    awaiting(function* () {
      if (parsed.fileArgs.length === 0) {
        return buildInitialMessage({ parsed, stdinContent });
      }

      const { text, images } = yield* awaited(
        processFileArguments(parsed.fileArgs, { autoResizeImages: false }),
      );
      return buildInitialMessage({
        fileImages: images,
        fileText: text,
        parsed,
        stdinContent,
      });
    }),
  );
}

function* parseCliArgs(args: string[]) {
  const parsed = parseArgs(args);
  if (parsed.diagnostics.length > 0) {
    for (const d of parsed.diagnostics) {
      const color = d.type === "error" ? chalk.red : chalk.yellow;
      writeError(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
    }
    if (parsed.diagnostics.some((d) => d.type === "error")) {
      process.exit(1);
    }
  }
  time("parseArgs");

  if (parsed.version === true) {
    writeLog(VERSION);
    process.exit(0);
  }

  if (parsed.export !== undefined && parsed.export !== "") {
    let result: string;
    try {
      const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
      result = yield* awaited(exportFromFile(parsed.export, outputPath));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to export session";
      writeError(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
    writeLog(`Exported to: ${result}`);
    process.exit(0);
  }

  let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
  const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
  if (shouldTakeOverStdout) {
    takeOverStdout();
  }

  if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
    writeError(chalk.red("Error: @file arguments are not supported in RPC mode"));
    process.exit(1);
  }

  validateForkFlags(parsed);
  validateSessionIdFlags(parsed);
  return { appMode, parsed };
}

const cliInput = {
  EXTENSION_LOAD_FAILURE_HINT,
  isTruthyEnvFlag,
  parseCliArgs,
  prepareInitialMessage,
  readPipedStdin,
  reportDiagnostics,
  resolveCliPaths,
  toPrintOutputMode,
};

export default cliInput;
