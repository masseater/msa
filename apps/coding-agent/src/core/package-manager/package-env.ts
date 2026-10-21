import { homedir } from "node:os";

import { valid, validRange } from "semver";

import nodeFs from "../platform/node/fs.ts";
import processEnv from "../process-env.ts";

const { readEnv, envSnapshot, envNames } = processEnv;
const { readFileSync } = nodeFs;

function getEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "linux" || envNames().length > 0) {
    return envSnapshot();
  }
  try {
    const data = readFileSync("/proc/self/environ", "utf-8");
    const env: NodeJS.ProcessEnv = {};
    for (const entry of data.split("\0")) {
      const idx = entry.indexOf("=");
      if (idx > 0) {
        env[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
    }
    return env;
  } catch {
    return envSnapshot();
  }
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
