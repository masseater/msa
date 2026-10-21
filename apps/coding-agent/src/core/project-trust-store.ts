import lockfile from "proper-lockfile";

import errors from "../utils/errors.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import platform from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import trustManager from "./trust-manager.ts";
import type trustManagerTypes from "./trust-manager.types.ts";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = nodeFs;
const { resolvePath } = paths;
const { dirname, join, nowMs } = platform;
const { stripBom } = text;
const { toErrorMessage } = errors;
const { normalizeCwd } = trustManager;

type TrustFile = Record<string, boolean | null | undefined>;
function findNearestTrustEntry(
  data: TrustFile,
  cwd: string,
): trustManagerTypes.ProjectTrustStoreEntry | null {
  let currentDir = normalizeCwd(cwd);
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
function readTrustFile(path: string): TrustFile {
  if (!existsSync(path)) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(readFileSync(path, "utf-8")));
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
function writeTrustFile(path: string, data: TrustFile): void {
  const sorted: TrustFile = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === true || value === false || value === null) {
      sorted[key] = value;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
}
function acquireTrustLockSync(path: string): () => void {
  const trustDir = dirname(path);
  mkdirSync(trustDir, { recursive: true });
  const maxAttempts = 10;
  const delayMs = 20;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return lockfile.lockSync(trustDir, { lockfilePath: `${path}.lock`, realpath: false });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      if (code !== "ELOCKED" || attempt === maxAttempts) {
        throw error;
      }
      lastError = error;
      const start = nowMs();
      while (nowMs() - start < delayMs) {}
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Failed to acquire trust store lock");
}
function withTrustFileLock<T>(path: string, fn: () => T): T {
  const release = acquireTrustLockSync(path);
  try {
    return fn();
  } finally {
    release();
  }
}
export default class ProjectTrustStore {
  private trustPath: string;

  constructor(agentDir: string) {
    this.trustPath = join(resolvePath(agentDir), "trust.json");
  }

  get(cwd: string): trustManagerTypes.ProjectTrustDecision {
    return this.getEntry(cwd)?.decision ?? null;
  }

  getEntry(cwd: string): trustManagerTypes.ProjectTrustStoreEntry | null {
    return withTrustFileLock(this.trustPath, () => {
      const data = readTrustFile(this.trustPath);
      return findNearestTrustEntry(data, cwd);
    });
  }

  set(cwd: string, decision: trustManagerTypes.ProjectTrustDecision): void {
    this.setMany([{ decision, path: cwd }]);
  }

  setMany(decisions: trustManagerTypes.ProjectTrustUpdate[]): void {
    withTrustFileLock(this.trustPath, () => {
      const data = readTrustFile(this.trustPath);
      for (const { path, decision } of decisions) {
        const key = normalizeCwd(path);
        if (decision === null) {
          delete data[key];
        } else {
          data[key] = decision;
        }
      }
      writeTrustFile(this.trustPath, data);
    });
  }
}
