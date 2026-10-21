import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import errors from "../utils/errors.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import awaitingModule from "./awaiting.ts";
import platform from "./platform/index.ts";
import trustManager from "./trust-manager.ts";
import type trustManagerTypes from "./trust-manager.types.ts";

const { resolvePath } = paths;
const { dirname, join } = platform;
const { exists, makeDirectory, readText, writeFile } = platform.files;
const { stripBom } = text;
const { toErrorMessage } = errors;
const { normalizeCwd } = trustManager;
const { awaited, awaiting } = awaitingModule;

const LOCK_RETRIES = { factor: 1, maxTimeout: 20, minTimeout: 20, retries: 9 };

type TrustFile = Record<string, boolean | null | undefined>;
function nearestTrustEntry(
  data: TrustFile,
  start: string,
): trustManagerTypes.ProjectTrustStoreEntry | null {
  let currentDir = start;
  while (true) {
    const value = data[currentDir];
    if (value === true || value === false) {
      return { decision: value, path: currentDir };
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}
function parseTrustFile(path: string, content: string): TrustFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(content));
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`Failed to read trust store ${path}: ${message}`, { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid trust store ${path}: expected an object`);
  }

  const data: TrustFile = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(
        `Invalid trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`,
      );
    }
    data[key] = value;
  }
  return data;
}
function readTrustFile(path: string): Promise<TrustFile> {
  return exists(path).then((found) =>
    found ? readText(path).then((content) => parseTrustFile(path, content)) : {},
  );
}
function writeTrustFile(path: string, data: TrustFile): Promise<void> {
  const sorted: TrustFile = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === true || value === false || value === null) {
      sorted[key] = value;
    }
  }
  return makeDirectory({ path: dirname(path) }).then(() =>
    writeFile({ data: `${JSON.stringify(sorted, null, 2)}\n`, path }),
  );
}
function withTrustFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const trustDir = dirname(path);
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(makeDirectory({ path: trustDir }));
      const release = yield* awaited(
        lockfile.lock(trustDir, {
          lockfilePath: `${path}.lock`,
          realpath: false,
          retries: LOCK_RETRIES,
        }),
      );
      try {
        return yield* awaited(fn());
      } finally {
        yield* awaited(release());
      }
    }),
  );
}
export default class ProjectTrustStore {
  private trustPath: string;

  constructor(agentDir: string) {
    this.trustPath = join(resolvePath(agentDir), "trust.json");
  }

  get(cwd: string): Promise<trustManagerTypes.ProjectTrustDecision> {
    return this.getEntry(cwd).then((entry) => entry?.decision ?? null);
  }

  getEntry(cwd: string): Promise<trustManagerTypes.ProjectTrustStoreEntry | null> {
    return withTrustFileLock(this.trustPath, () =>
      Promise.all([readTrustFile(this.trustPath), normalizeCwd(cwd)]).then(([data, start]) =>
        nearestTrustEntry(data, start),
      ),
    );
  }

  set(cwd: string, decision: trustManagerTypes.ProjectTrustDecision): Promise<void> {
    return this.setMany([{ decision, path: cwd }]);
  }

  setMany(decisions: trustManagerTypes.ProjectTrustUpdate[]): Promise<void> {
    return withTrustFileLock(this.trustPath, () =>
      Promise.all([
        readTrustFile(this.trustPath),
        Promise.all(decisions.map(({ path }) => normalizeCwd(path))),
      ]).then(([data, keys]) => {
        for (const [index, { decision }] of decisions.entries()) {
          const key = keys[index]!;
          if (decision === null) {
            delete data[key];
          } else {
            data[key] = decision;
          }
        }
        return writeTrustFile(this.trustPath, data);
      }),
    );
  }
}
