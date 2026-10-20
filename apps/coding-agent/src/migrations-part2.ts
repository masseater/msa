import chalk from "chalk";
import * as Effect from "effect/Effect";

import awaitingModule from "./core/awaiting.ts";
import platform from "./core/platform.ts";
import nodeFs from "./core/platform/node/fs.ts";
import migrationsPart1 from "./migrations-part1.ts";
import interop from "./utils/interop.ts";
import text from "./utils/text.ts";

const { awaited, awaiting } = awaitingModule;
const { writeLog } = platform;
const { callbackPromise } = interop;
const { existsSync, readFileSync, writeFileSync } = nodeFs;
const { stripBom } = text;
const { EXTENSIONS_DOC_URL, MIGRATION_GUIDE_URL } = migrationsPart1;

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

function renamedProviderId(id: string): string | undefined {
  if (id === "anthropic") return "anthropic-api";
  if (id === "claude-code" || id.startsWith("claude-code-")) return `claude-subs${id.slice(11)}`;
  return undefined;
}

function renameProviderRef(value: string): string {
  const slash = value.indexOf("/");
  const provider = slash < 0 ? value : value.slice(0, slash);
  const renamed = renamedProviderId(provider);
  return renamed === undefined ? value : renamed + value.slice(provider.length);
}

function renameProviderRefsIn(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameProviderRefsIn);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.includes("/") ? renameProviderRef(key) : key,
        renameProviderRefsIn(entry),
      ]),
    );
  }
  return typeof value === "string" && value.includes("/") ? renameProviderRef(value) : value;
}

function renameKeys(record: Record<string, unknown>): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(record)) {
    const renamed = renamedProviderId(key);
    if (renamed === undefined) continue;
    if (!(renamed in record)) record[renamed] = value;
    delete record[key];
    changed = true;
  }
  return changed;
}

function rewriteJson(path: string, update: (data: Record<string, unknown>) => boolean): void {
  if (!existsSync(path)) return;
  try {
    const data = JSON.parse(stripBom(readFileSync(path, "utf-8"))) as Record<string, unknown>;
    if (update(data)) writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  } catch {}
}

const migrationsPart2 = {
  renameKeys,
  renameProviderRefsIn,
  renamedProviderId,
  rewriteJson,
  showDeprecationWarnings,
};

export default migrationsPart2;
