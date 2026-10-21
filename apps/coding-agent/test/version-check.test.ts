import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import versionCheck from "../src/utils/version-check.ts";
import testNetworkEnv from "./test-network-env.ts";

const { readEnv } = platform;
const {
  checkForNewMsaVersion,
  comparePackageVersions,
  formatVersionCheckError,
  getLatestMsaRelease,
  isNewerPackageVersion,
} = versionCheck;

const { allowNetwork } = testNetworkEnv;

const { awaited, runTest } = testing;

const originalSkipVersionCheck = readEnv("MSA_SKIP_VERSION_CHECK");

beforeEach(() => {
  allowNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSkipVersionCheck === undefined) {
    vi.stubEnv("MSA_SKIP_VERSION_CHECK", undefined);
  } else {
    vi.stubEnv("MSA_SKIP_VERSION_CHECK", originalSkipVersionCheck);
  }
});

const comparesPackageVersions = () => {
  expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
  expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
  expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
  expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
  expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
  expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
};

const returnsOnlyNewerVersions = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const fetchMock = vi.fn(() =>
        effectRunPromise(awaited(Response.json({ tag_name: "v1.2.3" }))),
      );
      vi.stubGlobal("fetch", fetchMock);

      yield* awaited(expect(checkForNewMsaVersion("1.2.3")).resolves.toBeUndefined());
      yield* awaited(expect(checkForNewMsaVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" }));
    }),
  );

const readsTheLatestVersionFromMsaS = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const fetchMock = vi.fn(() =>
        effectRunPromise(awaited(Response.json({ tag_name: "v1.2.4" }))),
      );
      vi.stubGlobal("fetch", fetchMock);

      yield* awaited(expect(getLatestMsaRelease("1.2.3")).resolves.toEqual({ version: "1.2.4" }));
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/repos/masseater/msa/releases/latest",
        expect.anything(),
      );
    }),
  );

const retriesATransientVersionRequestWhenExplicitly = () =>
  runTest(
    Effect.gen(function* () {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce(Response.json({ tag_name: "v1.2.4" }));
      vi.stubGlobal("fetch", fetchMock);

      yield* awaited(
        expect(getLatestMsaRelease("1.2.3", { retry: true })).resolves.toEqual({
          version: "1.2.4",
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }),
  );

const keepsAutomaticVersionChecksToOneRequest = () =>
  runTest(
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
      vi.stubGlobal("fetch", fetchMock);

      yield* awaited(expect(checkForNewMsaVersion("1.2.3")).resolves.toBeUndefined());
      expect(fetchMock).toHaveBeenCalledOnce();
    }),
  );

const formatsNestedNetworkErrorDetails = () => {
  const error = new Error("fetch failed", {
    cause: new AggregateError([
      Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }),
      Object.assign(new Error("network unreachable"), { code: "ENETUNREACH" }),
    ]),
  });

  expect(formatVersionCheckError(error)).toBe("fetch failed (ETIMEDOUT, ENETUNREACH)");
};

const skipsAutomaticApiCallsWhenVersionChecks = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("MSA_SKIP_VERSION_CHECK", "1");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      yield* awaited(expect(checkForNewMsaVersion("1.2.3")).resolves.toBeUndefined());
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

const allowsDirectApiCallsWhenAutomaticVersion = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      vi.stubEnv("MSA_SKIP_VERSION_CHECK", "1");
      const fetchMock = vi.fn(() =>
        effectRunPromise(awaited(Response.json({ tag_name: "v1.2.4" }))),
      );
      vi.stubGlobal("fetch", fetchMock);

      yield* awaited(expect(getLatestMsaRelease("1.2.3")).resolves.toEqual({ version: "1.2.4" }));
      expect(fetchMock).toHaveBeenCalledOnce();
    }),
  );

describe("version checks", () => {
  it("compares package versions", comparesPackageVersions);

  it("returns only newer versions", returnsOnlyNewerVersions);

  it("reads the latest version from msa's GitHub releases", readsTheLatestVersionFromMsaS);

  it(
    "retries a transient version request when explicitly requested",
    retriesATransientVersionRequestWhenExplicitly,
  );

  it("keeps automatic version checks to one request", keepsAutomaticVersionChecksToOneRequest);

  it("formats nested network error details", formatsNestedNetworkErrorDetails);

  it(
    "skips automatic api calls when version checks are disabled",
    skipsAutomaticApiCallsWhenVersionChecks,
  );

  it(
    "allows direct api calls when automatic version checks are disabled",
    allowsDirectApiCallsWhenAutomaticVersion,
  );
});
