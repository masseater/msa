import chalk from "chalk";

import argsModule from "./cli/args.ts";
import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import exportHtml from "./core/export-html/index.ts";
import outputGuard from "./core/output-guard.ts";
import platformModule from "./core/platform.ts";
import timings from "./core/timings.ts";
import mainPart1 from "./main-part1.ts";
import mainPart5 from "./main-part5.ts";

const { parseArgs } = argsModule;
const { writeError, writeLog } = platformModule;
const { time } = timings;
const { VERSION } = config;
const { awaited } = awaitingModule;
const { exportFromFile } = exportHtml;
const { takeOverStdout } = outputGuard;
const { isPlainRuntimeMetadataCommand, resolveAppMode } = mainPart1;
const { validateForkFlags, validateSessionIdFlags } = mainPart5;

function* mainImplPart2(args: string[]) {
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

const mainPart12 = {
  mainImplPart2,
};

export default mainPart12;
