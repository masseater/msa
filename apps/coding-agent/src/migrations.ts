import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";

import chalk from "chalk";
import * as Effect from "effect/Effect";

import { CONFIG_DIR_NAME, getAgentDir, getBinDir } from "./config.ts";
import { awaited, awaiting } from "./core/awaiting.ts";
import { migrateKeybindingsConfig } from "./core/keybindings.ts";
import { dirname, join } from "./core/platform-node.ts";
import { writeLog } from "./core/platform.ts";
import { callbackPromise } from "./utils/interop.ts";
import { stripBom } from "./utils/text.ts";

const MIGRATION_GUIDE_URL =
  "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md#extensions-migration";
const EXTENSIONS_DOC_URL =
  "https://github.com/masseater/msa/blob/main/apps/coding-agent/docs/extensions.md";

function migrateApiKeys(
  apiKeys: Record<string, unknown>,
  migrated: Record<string, unknown>,
  providers: string[],
): void {
  for (const [provider, key] of Object.entries(apiKeys)) {
    if (migrated[provider] !== undefined || typeof key !== "string") continue;
    migrated[provider] = { type: "api_key", key };
    providers.push(provider);
  }
}

export function migrateAuthToAuthJson(): string[] {
  const agentDir = getAgentDir();
  const authPath = join(agentDir, "auth.json");
  const oauthPath = join(agentDir, "oauth.json");
  const settingsPath = join(agentDir, "settings.json");

  if (existsSync(authPath)) return [];

  const migrated: Record<string, unknown> = {};
  const providers: string[] = [];

  if (existsSync(oauthPath)) {
    try {
      const oauth = JSON.parse(stripBom(readFileSync(oauthPath, "utf-8")));
      for (const [provider, cred] of Object.entries(oauth)) {
        migrated[provider] = { type: "oauth", ...(cred as object) };
        providers.push(provider);
      }
      renameSync(oauthPath, `${oauthPath}.migrated`);
    } catch {}
  }

  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(stripBom(content)) as {
        apiKeys?: unknown;
        [key: string]: unknown;
      };
      if (typeof settings.apiKeys === "object" && settings.apiKeys !== null) {
        migrateApiKeys(settings.apiKeys as Record<string, unknown>, migrated, providers);
        delete settings.apiKeys;
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch {}
  }

  if (Object.keys(migrated).length > 0) {
    mkdirSync(dirname(authPath), { recursive: true });
    writeFileSync(authPath, JSON.stringify(migrated, null, 2), { mode: 0o600 });
  }

  return providers;
}

export function migrateSessionsFromAgentRoot(): void {
  const agentDir = getAgentDir();

  let files: string[];
  try {
    files = readdirSync(agentDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(agentDir, f));
  } catch {
    return;
  }

  if (files.length === 0) return;

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf8");
      const firstLine = content.split("\n")[0];
      if (firstLine === undefined || firstLine.trim() === "") continue;

      const header = JSON.parse(firstLine);
      if (header.type !== "session" || typeof header.cwd !== "string" || header.cwd === "")
        continue;

      const cwd: string = header.cwd;

      const safePath = `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
      const correctDir = join(agentDir, "sessions", safePath);

      if (!existsSync(correctDir)) {
        mkdirSync(correctDir, { recursive: true });
      }

      const fileName = file.split("/").pop() || file.split("\\").pop();
      const newPath = join(correctDir, fileName!);

      if (existsSync(newPath)) continue;

      renameSync(file, newPath);
    } catch {}
  }
}

function migrateCommandsToPrompts(baseDir: string, label: string): boolean {
  const commandsDir = join(baseDir, "commands");
  const promptsDir = join(baseDir, "prompts");

  if (existsSync(commandsDir) && !existsSync(promptsDir)) {
    try {
      renameSync(commandsDir, promptsDir);
      writeLog(chalk.green(`Migrated ${label} commands/ → prompts/`));
      return true;
    } catch (err) {
      writeLog(
        chalk.yellow(
          `Warning: Could not migrate ${label} commands/ to prompts/: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
  }
  return false;
}

function migrateKeybindingsConfigFile(): void {
  const configPath = join(getAgentDir(), "keybindings.json");
  if (!existsSync(configPath)) return;

  try {
    const parsed = JSON.parse(stripBom(readFileSync(configPath, "utf-8"))) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return;
    }
    const { config, migrated } = migrateKeybindingsConfig(parsed as Record<string, unknown>);
    if (!migrated) return;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  } catch {}
}

function migrateToolsToBin(): void {
  const agentDir = getAgentDir();
  const toolsDir = join(agentDir, "tools");
  const binDir = getBinDir();

  if (!existsSync(toolsDir)) return;

  const binaries = ["fd", "rg", "fd.exe", "rg.exe"];
  let movedAny = false;

  for (const bin of binaries) {
    const oldPath = join(toolsDir, bin);
    const newPath = join(binDir, bin);

    if (existsSync(oldPath)) {
      if (!existsSync(binDir)) {
        mkdirSync(binDir, { recursive: true });
      }
      if (existsSync(newPath)) {
        try {
          rmSync?.(oldPath, { force: true });
        } catch {}
      } else {
        try {
          renameSync(oldPath, newPath);
          movedAny = true;
        } catch {}
      }
    }
  }

  if (movedAny) {
    writeLog(chalk.green(`Migrated managed binaries tools/ → bin/`));
  }
}

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

export function showDeprecationWarnings(warnings: string[]): Promise<void> {
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
  } catch {
    return;
  }
}

function migrateRenamedProviders(): void {
  const agentDir = getAgentDir();
  rewriteJson(join(agentDir, "auth.json"), (data) => {
    const anthropic = data["anthropic"] as { type?: unknown } | undefined;
    if (anthropic?.type === "oauth") delete data["anthropic"];
    return renameKeys(data) || anthropic?.type === "oauth";
  });
  rewriteJson(join(agentDir, "models.json"), (data) =>
    data["providers"] !== null && typeof data["providers"] === "object"
      ? renameKeys(data["providers"] as Record<string, unknown>)
      : false,
  );
  rewriteJson(join(agentDir, "settings.json"), (data) => {
    const before = JSON.stringify(data);
    const renamed = renameProviderRefsIn(data) as Record<string, unknown>;
    const provider = renamed["defaultProvider"];
    if (typeof provider === "string")
      renamed["defaultProvider"] = renamedProviderId(provider) ?? provider;
    if (JSON.stringify(renamed) === before) return false;
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, renamed);
    return true;
  });
}

export function runMigrations(cwd: string): {
  migratedAuthProviders: string[];
  deprecationWarnings: string[];
} {
  const migratedAuthProviders = migrateAuthToAuthJson();
  migrateSessionsFromAgentRoot();
  migrateToolsToBin();
  migrateKeybindingsConfigFile();
  migrateRenamedProviders();
  const deprecationWarnings = migrateExtensionSystem(cwd);
  return { migratedAuthProviders, deprecationWarnings };
}
