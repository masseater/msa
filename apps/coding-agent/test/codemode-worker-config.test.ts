import { describe, expect, test } from "vite-plus/test";

import config from "../src/config.ts";

const { resolveCodemodeWorkerSpecifier } = config;

const usesARelativeSourceEntrypointInBun = () => {
  expect(resolveCodemodeWorkerSpecifier("bun-binary", "file:///B:/~BUN/root/config.js")).toBe(
    "./src/extensions/codemode/worker.ts",
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
  test("uses a relative source entrypoint in Bun binaries", usesARelativeSourceEntrypointInBun);

  test(
    "uses the emitted worker beside the bundled Node module",
    usesTheEmittedWorkerBesideTheBundled,
  );

  test("uses the msa-codemode worker when unbundled", usesTheMsaCodemodeWorkerWhenUnbundled);
});
