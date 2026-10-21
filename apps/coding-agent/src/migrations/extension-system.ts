import chalk from "chalk";
import * as Effect from "effect/Effect";

import configModule from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platformNode from "../core/platform-node.ts";
import platform from "../core/platform.ts";
import nodeFs from "../core/platform/node/fs.ts";
import interop from "../utils/interop.ts";
import legacyLayout from "./legacy-layout.ts";

const { callbackPromise } = interop;
const { awaited, awaiting } = awaitingModule;
const { writeLog } = platform;
const { CONFIG_DIR_NAME, getAgentDir } = configModule;
const { readdirSync, existsSync } = nodeFs;
const { join } = platformNode;
const { migrateCommandsToPrompts } = legacyLayout;

const MIGRATION_GUIDE_URL =
  "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md#extensions-migration";

const EXTENSIONS_DOC_URL =
  "https://github.com/masseater/msa/blob/main/apps/coding-agent/docs/extensions.md";

function checkDeprecatedExtensionDirs(baseDir: string, label: string): string[] {
  const hooksDir = join(baseDir, "hooks");
  const toolsDir = join(baseDir, "tools");
  const warnings: string[] = [];

  if (existsSync(hooksDir)) {
    warnings.push(`${label} hooks/ directory found. Hooks have been renamed to extensions.`);
  }

  if (existsSync(toolsDir)) {
    try {
      const entries = readdirSync(toolsDir);
      const customTools = entries.filter((e) => {
        const lower = e.toLowerCase();
        return (
          lower !== "fd" &&
          lower !== "rg" &&
          lower !== "fd.exe" &&
          lower !== "rg.exe" &&
          !e.startsWith(".")
        );
      });
      if (customTools.length > 0) {
        warnings.push(
          `${label} tools/ directory contains custom tools. Custom tools have been merged into extensions.`,
        );
      }
    } catch {}
  }

  return warnings;
}

function migrateExtensionSystem(cwd: string): string[] {
  const agentDir = getAgentDir();
  const projectDir = join(cwd, CONFIG_DIR_NAME);

  migrateCommandsToPrompts(agentDir, "Global");
  migrateCommandsToPrompts(projectDir, "Project");

  const warnings = [
    ...checkDeprecatedExtensionDirs(agentDir, "Global"),
    ...checkDeprecatedExtensionDirs(projectDir, "Project"),
  ];

  return warnings;
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
