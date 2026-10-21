import chalk from "chalk";
import * as Effect from "effect/Effect";

import configModule from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import interop from "../utils/interop.ts";
import legacyLayout from "./legacy-layout.ts";

const { callbackPromise } = interop;
const { awaited, awaiting } = awaitingModule;
const { join, writeLog } = platform;
const { CONFIG_DIR_NAME, getAgentDir } = configModule;
const { exists, readDirectory } = platform.files;
const { migrateCommandsToPrompts } = legacyLayout;

const MIGRATION_GUIDE_URL =
  "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md#extensions-migration";

const EXTENSIONS_DOC_URL =
  "https://github.com/masseater/msa/blob/main/apps/coding-agent/docs/extensions.md";

const isCustomTool = (entry: string): boolean => {
  const lower = entry.toLowerCase();
  return (
    lower !== "fd" &&
    lower !== "rg" &&
    lower !== "fd.exe" &&
    lower !== "rg.exe" &&
    !entry.startsWith(".")
  );
};

function checkDeprecatedExtensionDirs(baseDir: string, label: string): Promise<string[]> {
  return Promise.all([
    exists(join(baseDir, "hooks")),
    readDirectory(join(baseDir, "tools")).then(
      (entries) => entries.some(isCustomTool),
      () => false,
    ),
  ]).then(([hasHooks, hasCustomTools]) => [
    ...(hasHooks
      ? [`${label} hooks/ directory found. Hooks have been renamed to extensions.`]
      : []),
    ...(hasCustomTools
      ? [
          `${label} tools/ directory contains custom tools. Custom tools have been merged into extensions.`,
        ]
      : []),
  ]);
}

function migrateExtensionSystem(cwd: string, agentDir: string = getAgentDir()): Promise<string[]> {
  const projectDir = join(cwd, CONFIG_DIR_NAME);
  return migrateCommandsToPrompts(agentDir, "Global")
    .then(() => migrateCommandsToPrompts(projectDir, "Project"))
    .then(() =>
      Promise.all([
        checkDeprecatedExtensionDirs(agentDir, "Global"),
        checkDeprecatedExtensionDirs(projectDir, "Project"),
      ]),
    )
    .then((warnings) => warnings.flat());
}

function showDeprecationWarnings(warnings: string[]): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      if (warnings.length === 0) return;

      for (const warning of warnings) {
        writeLog(chalk.yellow(`Warning: ${warning}`));
      }
      writeLog(chalk.yellow(`\nMove your extensions to the extensions/ directory.`));
      writeLog(chalk.yellow(`Migration guide: ${MIGRATION_GUIDE_URL}`));
      writeLog(chalk.yellow(`Documentation: ${EXTENSIONS_DOC_URL}`));
      writeLog(chalk.dim(`\nPress any key to continue...`));

      yield* awaited(
        callbackPromise<void>((resolve) => {
          process.stdin.setRawMode?.(true);
          process.stdin.resume();
          process.stdin.once("data", () => {
            process.stdin.setRawMode?.(false);
            process.stdin.pause();
            resolve();
          });
        }),
      );
      writeLog();
    }),
  );
}

const extensionSystem = { migrateExtensionSystem, showDeprecationWarnings };

export default extensionSystem;
