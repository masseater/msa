import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import {
  checkForNewMsaVersion,
  comparePackageVersions,
  formatVersionCheckError,
  getLatestMsaRelease,
  isNewerPackageVersion,
} from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

const originalSkipVersionCheck = readEnv("MSA_SKIP_VERSION_CHECK");

beforeEach(() => {
  allowNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSkipVersionCheck === undefined) {
    deleteEnv("MSA_SKIP_VERSION_CHECK");
  } else {
    writeEnv("MSA_SKIP_VERSION_CHECK", originalSkipVersionCheck);
  }
});

describe("version checks", () => {
  it("compares package versions", () => {
    expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
    expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
    expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
    expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
    expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
    expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
  });

  it("returns only newer versions", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const fetchMock = vi.fn(() =>
          effectRunPromise(awaited(Response.json({ tag_name: "v1.2.3" }))),
        );
        vi.stubGlobal("fetch", fetchMock);

        yield* awaited(expect(checkForNewMsaVersion("1.2.3")).resolves.toBeUndefined());
        yield* awaited(
          expect(checkForNewMsaVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" }),
        );
      }),
    ));

  it("reads the latest version from msa's GitHub releases", () =>
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
    ));

  it("retries a transient version request when explicitly requested", () =>
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
    ));

  it("keeps automatic version checks to one request", () =>
    runTest(
      Effect.gen(function* () {
        const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
        vi.stubGlobal("fetch", fetchMock);

        yield* awaited(expect(checkForNewMsaVersion("1.2.3")).resolves.toBeUndefined());
        expect(fetchMock).toHaveBeenCalledOnce();
      }),
    ));

  it("formats nested network error details", () => {
    const error = new Error("fetch failed", {
      cause: new AggregateError([
        Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }),
        Object.assign(new Error("network unreachable"), { code: "ENETUNREACH" }),
      ]),
    });

    expect(formatVersionCheckError(error)).toBe("fetch failed (ETIMEDOUT, ENETUNREACH)");
  });

  it("skips automatic api calls when version checks are disabled", () =>
    runTest(
      Effect.gen(function* () {
        writeEnv("MSA_SKIP_VERSION_CHECK", "1");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        yield* awaited(expect(checkForNewMsaVersion("1.2.3")).resolves.toBeUndefined());
        expect(fetchMock).not.toHaveBeenCalled();
      }),
    ));

  it("allows direct api calls when automatic version checks are disabled", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeEnv("MSA_SKIP_VERSION_CHECK", "1");
        const fetchMock = vi.fn(() =>
          effectRunPromise(awaited(Response.json({ tag_name: "v1.2.4" }))),
        );
        vi.stubGlobal("fetch", fetchMock);

        yield* awaited(expect(getLatestMsaRelease("1.2.3")).resolves.toEqual({ version: "1.2.4" }));
        expect(fetchMock).toHaveBeenCalledOnce();
      }),
    ));
});
