import chalk from "chalk";

import configModule from "../config.ts";
import keybindings from "../core/keybindings.ts";
import platform from "../core/platform/index.ts";
import text from "../utils/text.ts";

const { exists, makeDirectory, readDirectory, readText, remove, rename, writeFile } =
  platform.files;
const { getBinDir, getAgentDir } = configModule;
const { migrateKeybindingsConfig } = keybindings;
const { basename, dirname, join, writeLog } = platform;
const { stripBom } = text;

type Migrated = { credentials: Record<string, unknown>; providers: string[] };

const ignoreFailure = <A>(promise: Promise<A>, fallback: A): Promise<A> =>
  promise.catch(() => fallback);

function readJson(path: string): Promise<unknown> {
  return readText(path).then((content) => JSON.parse(stripBom(content)) as unknown);
}

function migrateOAuthFile(oauthPath: string, migrated: Migrated): Promise<void> {
  return readJson(oauthPath).then((oauth) => {
    for (const [provider, cred] of Object.entries(oauth as Record<string, unknown>)) {
      migrated.credentials[provider] = { type: "oauth", ...(cred as object) };
      migrated.providers.push(provider);
    }
    return rename({ from: oauthPath, to: `${oauthPath}.migrated` });
  });
}

function migrateApiKeys(apiKeys: Record<string, unknown>, migrated: Migrated): void {
  for (const [provider, key] of Object.entries(apiKeys)) {
    if (migrated.credentials[provider] !== undefined || typeof key !== "string") continue;
    migrated.credentials[provider] = { key, type: "api_key" };
    migrated.providers.push(provider);
  }
}

function migrateSettingsApiKeys(settingsPath: string, migrated: Migrated): Promise<void> {
  return readJson(settingsPath).then((parsed) => {
    const settings = parsed as { apiKeys?: unknown; [key: string]: unknown };
    if (typeof settings.apiKeys !== "object" || settings.apiKeys === null) return undefined;
    migrateApiKeys(settings.apiKeys as Record<string, unknown>, migrated);
    delete settings.apiKeys;
    return writeFile({ data: JSON.stringify(settings, null, 2), path: settingsPath });
  });
}

function writeMigratedAuth(authPath: string, migrated: Migrated): Promise<string[]> {
  if (Object.keys(migrated.credentials).length === 0) return Promise.resolve(migrated.providers);
  return makeDirectory({ path: dirname(authPath) })
    .then(() =>
      writeFile({
        data: JSON.stringify(migrated.credentials, null, 2),
        mode: 0o600,
        path: authPath,
      }),
    )
    .then(() => migrated.providers);
}

function migrateAuthToAuthJson(agentDir: string = getAgentDir()): Promise<string[]> {
  const authPath = join(agentDir, "auth.json");
  const migrated: Migrated = { credentials: {}, providers: [] };
  return exists(authPath).then((found) =>
    found
      ? []
      : ignoreFailure(migrateOAuthFile(join(agentDir, "oauth.json"), migrated), undefined)
          .then(() =>
            ignoreFailure(
              migrateSettingsApiKeys(join(agentDir, "settings.json"), migrated),
              undefined,
            ),
          )
          .then(() => writeMigratedAuth(authPath, migrated)),
  );
}

function sessionHeaderCwd(content: string): string | undefined {
  const firstLine = content.split("\n")[0];
  if (firstLine === undefined || firstLine.trim() === "") return undefined;
  const header = JSON.parse(firstLine) as { type?: unknown; cwd?: unknown };
  return header.type === "session" && typeof header.cwd === "string" && header.cwd !== ""
    ? header.cwd
    : undefined;
}

function moveSessionFile(agentDir: string, file: string): Promise<void> {
  return readText(file).then((content) => {
    const cwd = sessionHeaderCwd(content);
    if (cwd === undefined) return undefined;
    const safePath = `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
    const correctDir = join(agentDir, "sessions", safePath);
    const newPath = join(correctDir, basename(file));
    return makeDirectory({ path: correctDir })
      .then(() => exists(newPath))
      .then((taken) => (taken ? undefined : rename({ from: file, to: newPath })));
  });
}

function migrateSessionsFromAgentRoot(agentDir: string = getAgentDir()): Promise<void> {
  return readDirectory(agentDir)
    .then((entries) =>
      Promise.all(
        entries
          .filter((entry) => entry.endsWith(".jsonl"))
          .map((entry) =>
            ignoreFailure(moveSessionFile(agentDir, join(agentDir, entry)), undefined),
          ),
      ),
    )
    .then(
      () => undefined,
      () => undefined,
    );
}

function renameCommandsDir(
  commandsDir: string,
  promptsDir: string,
  label: string,
): Promise<boolean> {
  return rename({ from: commandsDir, to: promptsDir }).then(
    () => {
      writeLog(chalk.green(`Migrated ${label} commands/ → prompts/`));
      return true;
    },
    (err: unknown) => {
      writeLog(
        chalk.yellow(
          `Warning: Could not migrate ${label} commands/ to prompts/: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return false;
    },
  );
}

function migrateCommandsToPrompts(baseDir: string, label: string): Promise<boolean> {
  const commandsDir = join(baseDir, "commands");
  const promptsDir = join(baseDir, "prompts");
  return Promise.all([exists(commandsDir), exists(promptsDir)]).then(([hasCommands, hasPrompts]) =>
    hasCommands && !hasPrompts ? renameCommandsDir(commandsDir, promptsDir, label) : false,
  );
}

function migrateKeybindingsConfigFile(agentDir: string = getAgentDir()): Promise<void> {
  const configPath = join(agentDir, "keybindings.json");
  return readJson(configPath)
    .then((parsed) => {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      const { config, migrated } = migrateKeybindingsConfig(parsed as Record<string, unknown>);
      return migrated
        ? writeFile({ data: `${JSON.stringify(config, null, 2)}\n`, path: configPath })
        : undefined;
    })
    .catch(() => undefined);
}

const MANAGED_BINARIES = ["fd", "rg", "fd.exe", "rg.exe"];

function moveManagedBinary(oldPath: string, newPath: string): Promise<boolean> {
  return exists(newPath).then((taken) =>
    taken
      ? ignoreFailure(remove({ force: true, path: oldPath }), undefined).then(() => false)
      : rename({ from: oldPath, to: newPath }).then(
          () => true,
          () => false,
        ),
  );
}

function migrateBinary(toolsDir: string, binDir: string, bin: string): Promise<boolean> {
  const oldPath = join(toolsDir, bin);
  return exists(oldPath).then((found) =>
    found
      ? makeDirectory({ path: binDir }).then(() => moveManagedBinary(oldPath, join(binDir, bin)))
      : false,
  );
}

function migrateToolsToBin(
  agentDir: string = getAgentDir(),
  binDir: string = getBinDir(),
): Promise<void> {
  const toolsDir = join(agentDir, "tools");
  return exists(toolsDir)
    .then((found) =>
      found ? Promise.all(MANAGED_BINARIES.map((bin) => migrateBinary(toolsDir, binDir, bin))) : [],
    )
    .then((moved) => {
      if (moved.some(Boolean)) writeLog(chalk.green(`Migrated managed binaries tools/ → bin/`));
      return undefined;
    });
}

const legacyLayout = {
  migrateAuthToAuthJson,
  migrateCommandsToPrompts,
  migrateKeybindingsConfigFile,
  migrateSessionsFromAgentRoot,
  migrateToolsToBin,
};

export default legacyLayout;
