import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
describe("extensions discovery 4", () => {
  let tempDir: string;
  let extensionsDir: string;
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("msa-ext-test-");
        extensionsDir = joinPath(tempDir, "extensions");
        yield* makeDirectory(extensionsDir);
      }),
    ),
  );
  afterEach(() => runTest(removePath(tempDir)));
  const extensionCode = `
		export default function(msa) {
			msa.registerCommand("test", { handler: async () => {} });
		}
	`;
  const extensionCodeWithTool = (toolName: string) => `
		import { Type } from "typebox";
		export default function(msa) {
			msa.registerTool({
				name: "${toolName}",
				label: "${toolName}",
				description: "Test tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
			});
		}
	`;
  it("loadExtensions only loads explicit paths without discovery", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(
          joinPath(extensionsDir, "discovered.ts"),
          extensionCodeWithTool("discovered"),
        );

        const explicitPath = joinPath(tempDir, "explicit.ts");
        yield* writeTextFile(explicitPath, extensionCodeWithTool("explicit"));

        const { loadExtensions } = yield* awaited(import("../src/core/extensions/loader.ts"));
        const result = yield* awaited(loadExtensions([explicitPath], tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.tools.has("explicit")).toBe(true);
        expect(result.extensions[0]?.tools.has("discovered")).toBe(false);
      }),
    ));
  it("loadExtensions with no paths loads nothing", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(extensionsDir, "discovered.ts"), extensionCode);

        const { loadExtensions } = yield* awaited(import("../src/core/extensions/loader.ts"));
        const result = yield* awaited(loadExtensions([], tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(0);
      }),
    ));
});
