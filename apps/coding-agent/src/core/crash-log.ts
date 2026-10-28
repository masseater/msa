import config from "../config.ts";
import type crashLogTypes from "./crash-log.types.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import platform from "./platform/index.ts";
import crashFiles from "./platform/node/crash-files.ts";
import sourceInfoModule from "./source-info.ts";

const { readCrashFileBeforeExit, writeCrashFileBeforeExit } = crashFiles;
const { makeDirectory, readText, remove, writeFile } = platform.files;

const { VERSION, getAgentDir } = config;
const { dirname, join, nowIso, nowMs } = platform;
const { isSyntheticPath } = sourceInfoModule;

const MAX_CRASH_RECORDS = 5;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function crashLogPath(agentDir = getAgentDir()): string {
  return join(agentDir, "crashes.json");
}

const isCrashRecord = (record: unknown): record is crashLogTypes.CrashRecord =>
  typeof record === "object" &&
  record !== null &&
  typeof (record as crashLogTypes.CrashRecord).timestamp === "string" &&
  typeof (record as crashLogTypes.CrashRecord).message === "string";

function parseCrashLog(text: string | undefined): crashLogTypes.CrashRecord[] {
  if (text === undefined) return [];
  try {
    const records: unknown = JSON.parse(text);
    return Array.isArray(records) ? records.filter(isCrashRecord) : [];
  } catch {
    return [];
  }
}

const serializeCrashLog = (records: readonly crashLogTypes.CrashRecord[]): string =>
  `${JSON.stringify(records, null, 2)}\n`;

function readCrashLog(path = crashLogPath()): Promise<crashLogTypes.CrashRecord[]> {
  return readText(path).then(parseCrashLog, () => []);
}

function writeCrashLog(records: readonly crashLogTypes.CrashRecord[], path: string): Promise<void> {
  return makeDirectory({ path: dirname(path) }).then(() =>
    writeFile({ data: serializeCrashLog(records), path }),
  );
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

function normalizeStackFrames(stack: string): string {
  return stack
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
}

function isSingleFilePackage(extension: ExtensionStackMetadata): boolean {
  return (
    extension.sourceInfo.origin === "package" &&
    !/^(?:npm:|git:|https?:\/\/|ssh:\/\/)/u.test(extension.sourceInfo.source) &&
    /\.[cm]?[jt]s$/u.test(extension.sourceInfo.source)
  );
}

function findExtensionStackMatches(
  stack: string | undefined,
  extensions: readonly ExtensionStackMetadata[],
): string[] {
  if (stack === undefined || stack === "") return [];
  const normalizedStack = normalizeStackFrames(stack);
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const extension of extensions) {
    const resolvedPath = normalizeStackPath(extension.resolvedPath);
    const { packageRoot, directoryEntry, slashIndex } = extensionStackLocation(
      extension,
      isSingleFilePackage(extension),
      resolvedPath,
    );
    const matched = stackMentionsExtension(
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

function stackMentionsExtension(
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

function extensionStackLocation(
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
    const records = parseCrashLog(readCrashFileBeforeExit(path));
    writeCrashFileBeforeExit(
      path,
      serializeCrashLog([...records, record].slice(-MAX_CRASH_RECORDS)),
    );
    return record;
  } catch {
    return undefined;
  }
}

const markNotified = (records: readonly crashLogTypes.CrashRecord[]): crashLogTypes.CrashRecord[] =>
  records.map((record) => (record.notified === true ? record : { ...record, notified: true }));

function takeUnnotifiedCrash(
  path = crashLogPath(),
  now = nowMs(),
): Promise<crashLogTypes.CrashRecord | undefined> {
  return readCrashLog(path).then((records) => {
    const crash = [...records]
      .reverse()
      .find((record) => record.notified !== true && now - Date.parse(record.timestamp) <= MAX_AGE);
    if (crash === undefined) return undefined;
    return writeCrashLog(markNotified(records), path).then(
      () => crash,
      () => crash,
    );
  });
}

function clearCrashLog(path = crashLogPath()): Promise<void> {
  return remove({ force: true, path }).catch(() => undefined);
}

const crashLog = {
  clearCrashLog,
  findExtensionStackMatches,
  readCrashLog,
  recordCrash,
  takeUnnotifiedCrash,
};

export default crashLog;
