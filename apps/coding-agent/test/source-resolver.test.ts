import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

const { runNodeScript, runTest } = testing;

const sourceResolverUrl = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;
const conformanceRunUrl = new URL("mcp-conformance/run.ts", import.meta.url).href;

const REJECT_BUILD_OUTPUT = `
import { registerHooks } from "node:module";
const buildOutput = /\\/(?:libs|apps)\\/[^/]+\\/dist\\/|\\/node_modules\\/@msa\\/[^/]+\\/dist\\//u;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (buildOutput.test(result.url)) throw new Error("resolved to build output: " + result.url);
    return result;
  },
});
`;

const rejectBuildOutputUrl = `data:text/javascript,${encodeURIComponent(REJECT_BUILD_OUTPUT)}`;

const runFromSource = (source: string) =>
  runNodeScript(source, {
    nodeArgs: ["--import", rejectBuildOutputUrl, "--import", sourceResolverUrl],
    timeout: "60 seconds",
  });

describe("source resolver", () => {
  it(
    "loads without any workspace package's build output",
    () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* runFromSource(
            `await import("@msa/chord/sleep"); console.log(import.meta.resolve("@msa/chord/sleep"));`,
          );
          expect(result.stderr).toBe("");
          expect(result.stdout.trim()).toMatch(/\/libs\/chord\/src\/sleep\.ts$/u);
          expect(result.code).toBe(0);
        }),
      ),
    60_000,
  );

  it(
    "runs the MCP conformance runner without any workspace package's build output",
    () =>
      runTest(
        Effect.gen(function* () {
          const result = yield* runFromSource(
            `process.argv.push("--help"); await import("${conformanceRunUrl}");`,
          );
          expect(result.stderr).toBe("");
          expect(result.stdout).toContain("Usage: vp run test:mcp-conformance");
          expect(result.code).toBe(0);
        }),
      ),
    60_000,
  );
});
