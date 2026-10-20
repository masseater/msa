import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createWebFetchToolDefinition } from "../src/core/tools/web-fetch.ts";
import { findTreg } from "../src/core/treg.ts";
import webToolsSupport from "./web-tools-support.ts";

const { cli, fakeTreg, run, text } = webToolsSupport;

const {
  abortController,
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
} = testing;

const fetchResult = {
  _treg: { served_by: "crawl4ai.web.scrape", tried: [] },
  output: {
    count: 1,
    pages: [
      {
        final_url: "https://example.com/",
        text: "This domain is for use in documentation examples.",
        title: "Example Domain",
        url: "https://example.com",
      },
    ],
  },
  raw: {},
};

const runsTregWebExtractAndReturnsThe = () =>
  runTest(
    Effect.gen(function* () {
      const runner = cli(fetchResult, 200, 150);
      const tool = createWebFetchToolDefinition({ run: runner });

      const result = yield* awaited(run(tool, { url: "https://example.com" }));

      expect(runner.mock.calls[0]![0].slice(0, 7)).toEqual([
        "--json",
        "call",
        "treg.web.extract",
        "--method",
        "POST",
        "--data",
        '{"url":"https://example.com"}',
      ]);
      expect(text(result)).toBe(
        "# Example Domain\nhttps://example.com/\n\nThis domain is for use in documentation examples.",
      );
      expect(result.details).toEqual({
        costMicro: 150,
        servedBy: "crawl4ai.web.scrape",
        title: "Example Domain",
        url: "https://example.com/",
      });
    }),
  );

const readsTheContentFieldOtherVendorsUse = () =>
  runTest(
    Effect.gen(function* () {
      const tool = createWebFetchToolDefinition({
        run: cli({
          output: { pages: [{ content: "Quickstart", url: "https://docs.keenable.ai/" }] },
        }),
      });

      const result = yield* awaited(run(tool, { url: "https://docs.keenable.ai/" }));

      expect(text(result)).toBe("https://docs.keenable.ai/\n\nQuickstart");
    }),
  );

const failsWhenNoVendorCouldReadThe = () =>
  runTest(
    Effect.gen(function* () {
      const tool = createWebFetchToolDefinition({
        run: cli({ _treg: { served_by: null }, output: { pages: null } }),
      });

      yield* awaited(
        expect(run(tool, { url: "https://blocked.example" })).rejects.toThrow(
          "Could not read https://blocked.example: no vendor returned its content.",
        ),
      );
    }),
  );

describe("web_fetch tool", () => {
  it("runs treg.web.extract and returns the page as Markdown", runsTregWebExtractAndReturnsThe);

  it("reads the content field other vendors use", readsTheContentFieldOtherVendorsUse);

  it("fails when no vendor could read the page", failsWhenNoVendorCouldReadThe);
});

let bin2: string;

const needsTheCliOnPath = () => {
  expect(findTreg(() => null, { TREG_TOKEN: "token" })).toBeUndefined();
  expect(findTreg(() => "/usr/local/bin/treg", { TREG_TOKEN: "token" })).toBeDefined();
};

const asksTregConfigWhetherTheCliIs = Effect.gen(function* () {
  const signedIn = yield* fakeTreg(bin2, true);
  expect(findTreg(() => signedIn, {})).toBeDefined();
  const signedOut = yield* fakeTreg(bin2, false);
  expect(findTreg(() => signedOut, {})).toBeUndefined();
  expect(findTreg(() => signedOut, { TREG_TOKEN: " " })).toBeUndefined();
});

const runsTheCliAndReturnsItsOutput = () =>
  runTest(
    Effect.gen(function* () {
      const options = findTreg(() => process.execPath, { TREG_TOKEN: "token" })!;
      const output = yield* awaited(
        options.run(["-e", "console.log('ok'); console.error('note')"]),
      );
      expect(output).toEqual({ exitCode: 0, stderr: "note\n", stdout: "ok\n" });
    }),
  );

const stopsTheCliWhenTheCallIs = () =>
  runTest(
    Effect.gen(function* () {
      const options = findTreg(() => process.execPath, { TREG_TOKEN: "token" })!;
      const controller = abortController();
      const pending = options.run(["-e", "setTimeout(() => {}, 60_000)"], controller.signal);
      controller.abort();
      yield* awaited(expect(pending).rejects.toThrow());
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      bin2 = joinPath(tmpdir(), `msa-treg-bin-${currentTimeMillis()}-${randomSuffixSync()}`);
      yield* makeDirectory(bin2);
    }),
  );

describe("findTreg", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(bin2)));

  it("needs the CLI on PATH", needsTheCliOnPath);

  it("asks treg config whether the CLI is signed in", () => runTest(asksTregConfigWhetherTheCliIs));

  it("runs the CLI and returns its output", runsTheCliAndReturnsItsOutput);

  it("stops the CLI when the call is aborted", stopsTheCliWhenTheCallIs);
});
