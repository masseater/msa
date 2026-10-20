import config from "../config.ts";
import type crashLogTypes from "./crash-log.types.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";
import sourceInfoModule from "./source-info.ts";

const { mkdirSync, readFileSync, rmSync, writeFileSync } = nodeFs;

const { VERSION, getAgentDir } = config;
const { dirname, join } = platformNode;
const { isSyntheticPath } = sourceInfoModule;
const { nowIso, nowMs } = platform;

const MAX_CRASH_RECORDS = 5;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function crashLogPath(agentDir = getAgentDir()): string {
  return join(agentDir, "crashes.json");
}

function readCrashLog(path = crashLogPath()): crashLogTypes.CrashRecord[] {
  try {
    const records: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(records)
      ? records.filter(
          (record): record is crashLogTypes.CrashRecord =>
            typeof record === "object" &&
            record !== null &&
            typeof (record as crashLogTypes.CrashRecord).timestamp === "string" &&
            typeof (record as crashLogTypes.CrashRecord).message === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeCrashLog(records: readonly crashLogTypes.CrashRecord[], path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`);
}

type ExtensionStackMetadata = Pick<
  extensionsTypesTypes.Extension,
  "path" | "resolvedPath" | "sourceInfo"
>;

function normalizeStackPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+$/u, "");
}

function stackContainsPath(
  stack: string,
  targetPath: string,
  includeDescendants: boolean,
): boolean {
  const target = normalizeStackPath(targetPath);
  if (target === "" || isSyntheticPath(target)) return false;
  const caseInsensitive = /^[a-z]:\//iu.test(target);
  const haystack = caseInsensitive ? stack.toLowerCase() : stack;
  const needle = caseInsensitive ? target.toLowerCase() : target;
  if (includeDescendants) return haystack.includes(`${needle}/`);

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const next = haystack[index + needle.length];
    if (next === undefined || next === ":" || next === ")" || /\s/u.test(next)) return true;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return false;
}

function findExtensionStackMatches(
  stack: string | undefined,
  extensions: readonly ExtensionStackMetadata[],
): string[] {
  if (stack === undefined || stack === "") return [];
  const normalizedStack = stack
    .split("\n")
    .slice(1)
    .filter((line) => /^\s+at\s/u.test(line))
    .map((line) => {
      try {
        return decodeURI(line);
      } catch {
        return line;
      }
    })
    .join("\n")
    .replace(/\\/gu, "/");
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const extension of extensions) {
    const resolvedPath = normalizeStackPath(extension.resolvedPath);
    const singleFilePackage =
      extension.sourceInfo.origin === "package" &&
      !/^(?:npm:|git:|https?:\/\/|ssh:\/\/)/u.test(extension.sourceInfo.source) &&
      /\.[cm]?[jt]s$/u.test(extension.sourceInfo.source);
    const { packageRoot, directoryEntry, slashIndex } = findExtensionStackMatchesPart1(
      extension,
      singleFilePackage,
      resolvedPath,
    );
    const matched = findExtensionStackMatchesPart4(
      packageRoot,
      normalizedStack,
      directoryEntry,
      slashIndex,
      resolvedPath,
    );
    if (!matched) continue;

    const label =
      extension.sourceInfo.origin === "package" && extension.sourceInfo.source !== ""
        ? extension.sourceInfo.source
        : extension.path;
    if (!seen.has(label)) {
      seen.add(label);
      matches.push(label);
    }
  }
  return matches;
}

function findExtensionStackMatchesPart4(
  packageRoot: string | undefined,
  normalizedStack: string,
  directoryEntry: boolean,
  slashIndex: number,
  resolvedPath: string,
) {
  return findExtensionStackMatchesPart3(
    packageRoot,
    normalizedStack,
    directoryEntry,
    slashIndex,
    resolvedPath,
  );
}

function findExtensionStackMatchesPart3(
  packageRoot: string | undefined,
  normalizedStack: string,
  directoryEntry: boolean,
  slashIndex: number,
  resolvedPath: string,
) {
  return findExtensionStackMatchesPart2(
    packageRoot,
    normalizedStack,
    directoryEntry,
    slashIndex,
    resolvedPath,
  );
}

function findExtensionStackMatchesPart2(
  packageRoot: string | undefined,
  normalizedStack: string,
  directoryEntry: boolean,
  slashIndex: number,
  resolvedPath: string,
) {
  return packageRoot !== undefined && packageRoot !== ""
    ? stackContainsPath(normalizedStack, packageRoot, true)
    : directoryEntry && slashIndex !== -1
      ? stackContainsPath(normalizedStack, resolvedPath.slice(0, slashIndex), true)
      : stackContainsPath(normalizedStack, resolvedPath, false);
}

function findExtensionStackMatchesPart1(
  extension: ExtensionStackMetadata,
  singleFilePackage: boolean,
  resolvedPath: string,
) {
  const packageRoot =
    extension.sourceInfo.origin === "package" &&
    !singleFilePackage &&
    extension.sourceInfo.baseDir !== undefined &&
    extension.sourceInfo.baseDir !== ""
      ? extension.sourceInfo.baseDir
      : undefined;
  const slashIndex = resolvedPath.lastIndexOf("/");
  const directoryEntry = /\/index\.[cm]?[jt]s$/u.test(resolvedPath);
  return { directoryEntry, packageRoot, slashIndex };
}

function recordCrash(
  crash: {
    kind: crashLogTypes.CrashRecord["kind"];
    error: unknown;
    sessionFile?: string | undefined;
    cwd: string;
  },
  path = crashLogPath(),
): crashLogTypes.CrashRecord | undefined {
  try {
    const { error } = crash;
    const record: crashLogTypes.CrashRecord = {
      cwd: crash.cwd,
      kind: crash.kind,
      message:
        error instanceof Error
          ? error.message === ""
            ? error.name
            : error.message
          : String(error),
      sessionFile: crash.sessionFile ?? null,
      stack:
        error instanceof Error && error.stack !== undefined && error.stack !== ""
          ? error.stack
          : null,
      timestamp: nowIso(),
      version: VERSION,
    };
    writeCrashLog([...readCrashLog(path), record].slice(-MAX_CRASH_RECORDS), path);
    return record;
  } catch {
    return undefined;
  }
}

function takeUnnotifiedCrash(
  path = crashLogPath(),
  now = nowMs(),
): crashLogTypes.CrashRecord | undefined {
  const records = readCrashLog(path);
  const crash = [...records]
    .reverse()
    .find((record) => record.notified !== true && now - Date.parse(record.timestamp) <= MAX_AGE);
  if (crash === undefined) return undefined;
  try {
    writeCrashLog(
      records.map((record) =>
        record.notified === true ? record : Object.assign({}, record, { notified: true }),
      ),
      path,
    );
  } catch {}
  return crash;
}

function clearCrashLog(path = crashLogPath()): void {
  try {
    rmSync(path, { force: true });
  } catch {}
}

const crashLog = {
  clearCrashLog,
  findExtensionStackMatches,
  readCrashLog,
  recordCrash,
  takeUnnotifiedCrash,
};

export default crashLog;
