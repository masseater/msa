import chalk from "chalk";

import argsModule from "../cli/args.ts";
import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import exportHtml from "../core/export-html/index.ts";
import outputGuard from "../core/output-guard.ts";
import platform from "../core/platform/index.ts";
import timings from "../core/timings.ts";
import appModeModule from "./app-mode.ts";
import sessionFlags from "./session-flags.ts";

const { parseArgs } = argsModule;
const { VERSION } = config;
const { awaited } = awaitingModule;
const { exportFromFile } = exportHtml;
const { takeOverStdout } = outputGuard;
const { writeError, writeLog } = platform;
const { time } = timings;
const { isPlainRuntimeMetadataCommand, resolveAppMode } = appModeModule;
const { validateSessionIdFlags, validateForkFlags } = sessionFlags;

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

  const appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
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

const cliArgs = { parseCliArgs };

export default cliArgs;
