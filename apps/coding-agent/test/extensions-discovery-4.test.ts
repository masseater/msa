import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import extensionsDiscoverySupport from "./extensions-discovery-support.ts";
import tempDirKit from "./temp-dir.ts";

const { awaited, joinPath, runTest, writeTextFile } = testing;

const { extensionCodeWithTool, writeExtensionFiles } = extensionsDiscoverySupport;

const { useExtensionsDir } = tempDirKit;

const extTemp = useExtensionsDir("msa-ext-test-");

const loadextensionsOnlyLoadsExplicitPathsWithoutDiscovery = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extTemp.extensionsDir, "discovered.ts"),
        extensionCodeWithTool("discovered"),
      );

      const explicitPath = joinPath(extTemp.path, "explicit.ts");
      yield* writeTextFile(explicitPath, extensionCodeWithTool("explicit"));

      const { loadExtensions } = (yield* awaited(import("../src/core/extensions/loader.ts")))
        .default;
      const result = yield* awaited(loadExtensions([explicitPath], extTemp.path));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.tools.has("explicit")).toBe(true);
      expect(result.extensions[0]?.tools.has("discovered")).toBe(false);
    }),
  );

const loadextensionsWithNoPathsLoadsNothing = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionFiles(extTemp.extensionsDir, ["discovered.ts"]);

      const { loadExtensions } = (yield* awaited(import("../src/core/extensions/loader.ts")))
        .default;
      const result = yield* awaited(loadExtensions([], extTemp.path));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(0);
    }),
  );

describe("extensions discovery 4", () => {
  it(
    "loadExtensions only loads explicit paths without discovery",
    loadextensionsOnlyLoadsExplicitPathsWithoutDiscovery,
  );
  it("loadExtensions with no paths loads nothing", loadextensionsWithNoPathsLoadsNothing);
});
