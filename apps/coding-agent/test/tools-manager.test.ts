import { awaited, failure, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ensureTool, getLatestVersion, type ToolStatus } from "../src/utils/tools-manager.ts";

vi.mock("fs", (importOriginal) =>
  importOriginal().then((actual) => ({ ...(actual as object), existsSync: vi.fn(() => false) })),
);

vi.mock("child_process", (importOriginal) =>
  importOriginal().then((actual) => ({
    ...(actual as object),
    spawnSync: vi.fn(() => ({ error: new Error("not found") })),
  })),
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

describe("getLatestVersion", () => {
  it("resolves the version from the release page redirect", () =>
    runTest(
      Effect.gen(function* () {
        const fetchMock = vi.fn(() =>
          redirectResponse("https://github.com/sharkdp/fd/releases/tag/v10.4.2"),
        );
        vi.stubGlobal("fetch", fetchMock);

        expect(yield* awaited(getLatestVersion("sharkdp/fd"))).toBe("10.4.2");
        expect(fetchMock).toHaveBeenCalledWith(
          "https://github.com/sharkdp/fd/releases/latest",
          expect.objectContaining({ redirect: "manual" }),
        );
      }),
    ));

  it("keeps tags without a v prefix intact", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() =>
            redirectResponse("https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0"),
          ),
        );

        expect(yield* awaited(getLatestVersion("BurntSushi/ripgrep"))).toBe("15.2.0");
      }),
    ));

  it("resolves relative redirect targets", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => redirectResponse("/sharkdp/fd/releases/tag/v10.4.2")),
        );

        expect(yield* awaited(getLatestVersion("sharkdp/fd"))).toBe("10.4.2");
      }),
    ));

  it("discards the redirect response body", () =>
    runTest(
      Effect.gen(function* () {
        const response = new Response("<html></html>", {
          status: 302,
          headers: { location: "https://github.com/sharkdp/fd/releases/tag/v10.4.2" },
        });
        vi.stubGlobal(
          "fetch",
          vi.fn(() => response),
        );

        expect(yield* awaited(getLatestVersion("sharkdp/fd"))).toBe("10.4.2");
        expect(response.bodyUsed).toBe(true);
      }),
    ));

  it("fails clearly when the endpoint does not redirect", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => new Response("not found", { status: 404 })),
        );

        expect(yield* failure(awaited(getLatestVersion("sharkdp/fd")))).toMatchObject({
          message: "Failed to resolve latest sharkdp/fd release: HTTP 404 without redirect",
        });
      }),
    ));

  it("fails clearly when the redirect does not point at a release tag", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => redirectResponse("https://github.com/login")),
        );

        expect(yield* failure(awaited(getLatestVersion("sharkdp/fd")))).toMatchObject({
          message:
            "Failed to resolve latest sharkdp/fd release: unexpected redirect to https://github.com/login",
        });
      }),
    ));
});

describe("ensureTool", () => {
  it("reports status through a callback without writing to the console", () =>
    runTest(
      Effect.gen(function* () {
        const statuses: ToolStatus[] = [];
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

        vi.stubEnv("MSA_OFFLINE", "1");
        const result = yield* awaited(ensureTool("fd", (status) => statuses.push(status)));

        expect(result).toBeUndefined();
        expect(statuses).toEqual([
          {
            type: "warning",
            message: "fd not found. Offline mode enabled, skipping download.",
          },
        ]);
        expect(consoleLog).not.toHaveBeenCalled();
        consoleLog.mockRestore();
      }),
    ));

  it("surfaces the error cause chain when a download fails", () =>
    runTest(
      Effect.gen(function* () {
        const cause = new Error("connect ETIMEDOUT 140.82.113.3:443");
        vi.stubGlobal(
          "fetch",
          vi.fn(() => {
            throw new TypeError("fetch failed", { cause });
          }),
        );
        const statuses: ToolStatus[] = [];

        vi.stubEnv("MSA_OFFLINE", undefined);
        const result = yield* awaited(ensureTool("fd", (status) => statuses.push(status)));

        expect(result).toBeUndefined();
        expect(statuses).toEqual([
          { type: "info", message: "fd not found. Downloading..." },
          {
            type: "warning",
            message: "Failed to download fd: fetch failed: connect ETIMEDOUT 140.82.113.3:443",
          },
        ]);
      }),
    ));
});
