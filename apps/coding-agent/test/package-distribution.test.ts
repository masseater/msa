import { fileURLToPath } from "node:url";

import { readJsonFile, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

interface CodingAgentPackageJson {
  bin: { msa: string };
  main: string;
  exports: {
    ".": { import: string; types: string };
    "./rpc-entry": { import: string };
  };
}

describe("package distribution entrypoints", () => {
  test("uses the bundle for executables and modular output for libraries", () =>
    runTest(
      Effect.gen(function* () {
        const packageJson = (yield* readJsonFile(
          fileURLToPath(new URL("../package.json", import.meta.url)),
        )) as CodingAgentPackageJson;
        expect(packageJson.bin.msa).toBe("dist/bundle/cli.js");
        expect(packageJson.main).toBe("./dist/index.js");
        expect(packageJson.exports["."].import).toBe("./dist/index.js");
        expect(packageJson.exports["./rpc-entry"].import).toBe("./dist/bundle/rpc-entry.js");
      }),
    ));
});
