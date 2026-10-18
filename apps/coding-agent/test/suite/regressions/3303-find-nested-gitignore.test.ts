import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createFindToolDefinition } from "../../../src/core/tools/find.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempRoot: string;

function runFind(pattern: string): Promise<string[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const def = createFindToolDefinition(tempRoot);
      const ctx = {} as Parameters<typeof def.execute>[4];
      const result = (yield* Effect.promise(() =>
        def.execute("call-1", { pattern }, undefined, undefined, ctx),
      )) as {
        content: Array<{ type: string; text?: string }>;
      };
      const text = result.content[0]?.text ?? "";
      if (text === "No files found matching pattern") return [];
      return text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("["))
        .sort();
    }),
  );
}

const appliesAGitignoreOnlyInsideA = Effect.gen(function* () {
  const files = yield* Effect.promise(() => runFind("**/*.txt"));
  expect(files).toEqual(["a/kept.txt", "b/ignored.txt", "b/kept.txt", "root.txt"]);
});

const scopesEachGitignoreToItsOwn = Effect.gen(function* () {
  const files = yield* Effect.promise(() => runFind("**/*.txt"));

  expect(files).toEqual([
    "a/deep/kept.txt",
    "a/kept.txt",
    "b/ignored.txt",
    "b/kept.txt",
    "root.txt",
  ]);
});

describe("issue #3303 nested .gitignore rules leak into sibling directories", () => {
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        if (tempRoot !== "") yield* fs.remove(tempRoot, { recursive: true, force: true });
      }),
    ),
  );
  describe("flat sibling case", () => {
    beforeEach(() =>
      runtime.runPromise(
        Effect.gen(function* () {
          tempRoot = yield* fs.makeTempDirectory({ prefix: "msa-3303-flat-" });
          yield* fs.makeDirectory(join(tempRoot, "a"), { recursive: true });
          yield* fs.makeDirectory(join(tempRoot, "b"), { recursive: true });
          yield* fs.writeFileString(join(tempRoot, "a", ".gitignore"), "ignored.txt\n");
          yield* fs.writeFileString(join(tempRoot, "a", "ignored.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "a", "kept.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "b", "ignored.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "b", "kept.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "root.txt"), "");
        }),
      ),
    );
    it("applies a/.gitignore only inside a/ and leaves b/ untouched", () =>
      Effect.runPromise(appliesAGitignoreOnlyInsideA));
  });
  describe("deeply nested case", () => {
    beforeEach(() =>
      runtime.runPromise(
        Effect.gen(function* () {
          tempRoot = yield* fs.makeTempDirectory({ prefix: "msa-3303-deep-" });
          yield* fs.makeDirectory(join(tempRoot, "a", "deep"), { recursive: true });
          yield* fs.makeDirectory(join(tempRoot, "b"), { recursive: true });
          yield* fs.writeFileString(join(tempRoot, "a", ".gitignore"), "ignored.txt\n");
          yield* fs.writeFileString(join(tempRoot, "a", "deep", ".gitignore"), "secret.txt\n");
          yield* fs.writeFileString(join(tempRoot, "a", "ignored.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "a", "kept.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "a", "deep", "ignored.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "a", "deep", "secret.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "a", "deep", "kept.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "b", "ignored.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "b", "kept.txt"), "");
          yield* fs.writeFileString(join(tempRoot, "root.txt"), "");
        }),
      ),
    );
    it("scopes each .gitignore to its own subtree", () =>
      Effect.runPromise(scopesEachGitignoreToItsOwn));
  });
});
