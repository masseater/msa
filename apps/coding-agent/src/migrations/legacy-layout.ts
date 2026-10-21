import chalk from "chalk";

import configModule from "../config.ts";
import keybindings from "../core/keybindings.ts";
import platformNode from "../core/platform-node.ts";
import platform from "../core/platform.ts";
import nodeFs from "../core/platform/node/fs.ts";
import text from "../utils/text.ts";

const { rmSync, readdirSync, mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } =
  nodeFs;
const { getBinDir, getAgentDir } = configModule;
const { migrateKeybindingsConfig } = keybindings;
const { writeLog } = platform;
const { dirname, join } = platformNode;
const { stripBom } = text;

function migrateApiKeys(
  apiKeys: Record<string, unknown>,
  migrated: Record<string, unknown>,
  providers: string[],
): void {
  for (const [provider, key] of Object.entries(apiKeys)) {
    if (migrated[provider] !== undefined || typeof key !== "string") continue;
    migrated[provider] = { key, type: "api_key" };
    providers.push(provider);
  }
}

function migrateAuthToAuthJson(): string[] {
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

function migrateSessionsFromAgentRoot(): void {
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

const legacyLayout = {
  migrateAuthToAuthJson,
  migrateCommandsToPrompts,
  migrateKeybindingsConfigFile,
  migrateSessionsFromAgentRoot,
  migrateToolsToBin,
};

export default legacyLayout;
