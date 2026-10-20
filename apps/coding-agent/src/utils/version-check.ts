import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import { compare, valid } from "semver";

import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform.ts";
import managementHttp from "./management-http.ts";
import userAgent from "./user-agent.ts";
import type versionCheckTypes from "./version-check.types.ts";

const { awaited, awaiting } = awaitingModule;
const { readEnv } = platform;
const { fetchWithRetry } = managementHttp;
const { getMsaUserAgent } = userAgent;

const LATEST_RELEASE_URL = "https://api.github.com/repos/masseater/msa/releases/latest";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

function formatVersionCheckError(error: unknown): string {
  const rootMessage =
    error instanceof Error && error.message !== "" ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const causes =
    cause instanceof AggregateError ? cause.errors : cause === undefined ? [] : [cause];
  const codes = causes
    .map((value) =>
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string"
        ? value.code
        : undefined,
    )
    .filter((code): code is string => code !== undefined);

  if (codes.length > 0) return `${rootMessage} (${[...new Set(codes)].join(", ")})`;
  const causeMessage = causes.find(
    (value): value is Error => value instanceof Error && Boolean(value.message),
  )?.message;
  return causeMessage !== undefined && causeMessage !== ""
    ? `${rootMessage} (cause: ${causeMessage})`
    : rootMessage;
}

function comparePackageVersionsImpl(leftVersion: string, rightVersion: string): number | undefined {
  const left = valid(leftVersion.trim());
  const right = valid(rightVersion.trim());
  if (left === null || left === "" || right === null || right === "") {
    return undefined;
  }
  return compare(left, right);
}

const comparePackageVersions: {
  (leftVersion: string, rightVersion: string): number | undefined;
  (rightVersion: string): (leftVersion: string) => number | undefined;
} = dual((args: IArguments) => args.length >= 2, comparePackageVersionsImpl);

function isNewerPackageVersionImpl(candidateVersion: string, currentVersion: string): boolean {
  const comparison = comparePackageVersions(candidateVersion, currentVersion);
  if (comparison !== undefined) {
    return comparison > 0;
  }
  return candidateVersion.trim() !== currentVersion.trim();
}

const isNewerPackageVersion: {
  (candidateVersion: string, currentVersion: string): boolean;
  (currentVersion: string): (candidateVersion: string) => boolean;
} = dual((args: IArguments) => args.length >= 2, isNewerPackageVersionImpl);

function getLatestMsaReleaseImpl(
  currentVersion: string,
  options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<versionCheckTypes.LatestMsaRelease | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (readEnv("MSA_OFFLINE") !== undefined && readEnv("MSA_OFFLINE") !== "") return undefined;

      const response = yield* awaited(
        fetchWithRetry(
          LATEST_RELEASE_URL,
          {
            headers: {
              "User-Agent": getMsaUserAgent(currentVersion),
              accept: "application/vnd.github+json",
            },
          },
          {
            maxRetries: options.retry === true ? 2 : 0,
            timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
          },
        ),
      );
      if (!response.ok) return undefined;

      const data = (yield* awaited(response.json())) as { tag_name?: unknown };
      if (typeof data.tag_name !== "string") return undefined;
      const version = data.tag_name.trim().replace(/^v/u, "");
      return version === "" ? undefined : { version };
    }),
  );
}

const getLatestMsaRelease: {
  (
    currentVersion: string,
    options?: { timeoutMs?: number; retry?: boolean },
  ): Promise<versionCheckTypes.LatestMsaRelease | undefined>;
  (options?: {
    timeoutMs?: number;
    retry?: boolean;
  }): (currentVersion: string) => Promise<versionCheckTypes.LatestMsaRelease | undefined>;
} = dual((args: IArguments) => args.length >= 1, getLatestMsaReleaseImpl);

function checkForNewMsaVersion(
  currentVersion: string,
): Promise<versionCheckTypes.LatestMsaRelease | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (
        readEnv("MSA_SKIP_VERSION_CHECK") !== undefined &&
        readEnv("MSA_SKIP_VERSION_CHECK") !== ""
      )
        return undefined;

      try {
        const latestRelease = yield* awaited(getLatestMsaRelease(currentVersion));
        if (
          latestRelease !== undefined &&
          isNewerPackageVersion(latestRelease.version, currentVersion)
        ) {
          return latestRelease;
        }
        return undefined;
      } catch {
        return undefined;
      }
    }),
  );
}

const versionCheck = {
  checkForNewMsaVersion,
  comparePackageVersions,
  formatVersionCheckError,
  getLatestMsaRelease,
  isNewerPackageVersion,
};

export default versionCheck;
