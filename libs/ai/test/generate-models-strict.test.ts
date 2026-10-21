import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { describe, expect, it } from "vite-plus/test";

import nodeProcess from "./node-process.ts";

const { runNode } = nodeProcess;

const runtime = ManagedRuntime.make(NodeServices.layer);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const generatedPaths = [
  "src/models.generated.ts",
  "src/providers/openai.models.ts",
  "src/providers/data/openai.json",
  "src/providers/data/.manifest.json",
];

const offlineCatalogPreload = `globalThis.fetch = async (input) => {
  if (String(input) === "https://models.dev/api.json") {
    return new Response("{}", { status: 200 });
  }
  throw new Error(\`Unexpected fetch: \${String(input)}\`);
};
`;

const isolatePackage = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "msa-generate-models-" });
  const isolatedRoot = path.join(fixtureRoot, "package");
  yield* fs.makeDirectory(isolatedRoot);
  yield* Effect.forEach(["package.json", "scripts", "src"], (entry) =>
    fs.copy(path.join(packageRoot, entry), path.join(isolatedRoot, entry)),
  );
  yield* fs.symlink(
    path.join(packageRoot, "node_modules"),
    path.join(isolatedRoot, "node_modules"),
  );
  const preloadPath = path.join(fixtureRoot, "mock-models-dev.mjs");
  yield* fs.writeFileString(preloadPath, offlineCatalogPreload);
  return { isolatedRoot, preloadUrl: (yield* path.toFileUrl(preloadPath)).href };
});

const readGenerated = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.forEach(generatedPaths, (file) =>
      fs.readFileString(path.join(root, file)),
    );
  });

const failsBeforeMutatingGeneratedData = () =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { isolatedRoot, preloadUrl } = yield* isolatePackage;
        const sourceBefore = yield* readGenerated(packageRoot);
        const isolatedBefore = yield* readGenerated(isolatedRoot);
        const result = yield* Effect.promise(() =>
          runNode(["--import", preloadUrl, "scripts/generate-models.ts", "--strict"], {
            cwd: isolatedRoot,
            timeout: "10 seconds",
          }),
        );

        expect(result.exitCode).toBe(1);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          "Unexpected fetch: https://openrouter.ai/api/v1/models",
        );
        expect(yield* readGenerated(isolatedRoot)).toEqual(isolatedBefore);
        expect(yield* readGenerated(packageRoot)).toEqual(sourceBefore);
      }),
    ),
  );

describe("strict model generation", () => {
  it(
    "fails before mutating generated data when an upstream catalog is unavailable",
    failsBeforeMutatingGeneratedData,
  );
});
