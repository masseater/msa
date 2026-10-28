import { valid, validRange } from "semver";

import platformModule from "../platform/index.ts";
import nodeOs from "../platform/node/os.ts";
import processEnviron from "../platform/node/process-environ.ts";

const { homedir } = nodeOs;

const { envNames, envSnapshot, readEnv } = platformModule;
const { readProcessEnvironFile } = processEnviron;

function parseEnviron(data: string): NodeJS.ProcessEnv {
  return Object.fromEntries(
    data.split("\0").flatMap((entry) => {
      const idx = entry.indexOf("=");
      return idx > 0 ? [[entry.slice(0, idx), entry.slice(idx + 1)] as const] : [];
    }),
  );
}

function getEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "linux" || envNames().length > 0) {
    return envSnapshot();
  }
  const data = readProcessEnvironFile();
  return data === undefined ? envSnapshot() : parseEnviron(data);
}

const NETWORK_TIMEOUT_MS = 10000;

const UPDATE_CHECK_CONCURRENCY = 4;

const GIT_UPDATE_CONCURRENCY = 4;

function isOfflineModeEnabled(): boolean {
  const value = readEnv("MSA_OFFLINE");
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function getHomeDir(): string {
  return readEnv("HOME") || homedir();
}

function isExactNpmVersion(version: string | undefined): boolean {
  return valid(version ?? "") !== null;
}

function getNpmVersionRange(version: string | undefined): string | undefined {
  return version !== undefined && version !== "" ? (validRange(version) ?? undefined) : undefined;
}

const packageEnv = {
  GIT_UPDATE_CONCURRENCY,
  NETWORK_TIMEOUT_MS,
  UPDATE_CHECK_CONCURRENCY,
  getEnv,
  getHomeDir,
  getNpmVersionRange,
  isExactNpmVersion,
  isOfflineModeEnabled,
};

export default packageEnv;
