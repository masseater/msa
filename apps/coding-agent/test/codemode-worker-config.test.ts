import { describe, expect, test } from "vite-plus/test";

import config from "../src/config.ts";

const { resolveCodemodeWorkerSpecifier } = config;

const usesTheEmbeddedEntrypointInBun = () => {
  expect(resolveCodemodeWorkerSpecifier("bun-binary", "file:///B:/~BUN/root/config.js")).toBe(
    "./extensions/codemode/worker.js",
  );
};

const usesTheEmittedWorkerBesideTheBundled = () => {
  expect(resolveCodemodeWorkerSpecifier("bundled-node", "file:///app/chunks/config.js")).toEqual(
    new URL("file:///app/chunks/codemode-worker.js"),
  );
};

const usesTheMsaCodemodeWorkerWhenUnbundled = () => {
  expect(resolveCodemodeWorkerSpecifier("unbundled", import.meta.url)).toBeUndefined();
};

describe("resolveCodemodeWorkerSpecifier", () => {
  test("uses the embedded entrypoint in Bun binaries", usesTheEmbeddedEntrypointInBun);

  test(
    "uses the emitted worker beside the bundled Node module",
    usesTheEmittedWorkerBesideTheBundled,
  );

  test("uses the msa-codemode worker when unbundled", usesTheMsaCodemodeWorkerWhenUnbundled);
});
