import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import find from "../../../src/core/tools/find.ts";

const { createFindToolDefinition } = find;

const { joinPath } = testing;

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

const appliesAGitignoreOnlyInsideAAnd = () => Effect.runPromise(appliesAGitignoreOnlyInsideA);

const scopesEachGitignoreToItsOwnSubtree = () => Effect.runPromise(scopesEachGitignoreToItsOwn);

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      if (tempRoot !== "") yield* fs.remove(tempRoot, { force: true, recursive: true });
    }),
  );

const beforeEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      tempRoot = yield* fs.makeTempDirectory({ prefix: "msa-3303-flat-" });
      yield* fs.makeDirectory(joinPath(tempRoot, "a"), { recursive: true });
      yield* fs.makeDirectory(joinPath(tempRoot, "b"), { recursive: true });
      yield* fs.writeFileString(joinPath(tempRoot, "a", ".gitignore"), "ignored.txt\n");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "ignored.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "kept.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "b", "ignored.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "b", "kept.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "root.txt"), "");
    }),
  );

describe("issue #3303 nested .gitignore rules leak into sibling directories", () => {
  afterEach(afterEachHook);

  describe("flat sibling case", () => {
    beforeEach(beforeEachHook);
    it(
      "applies a/.gitignore only inside a/ and leaves b/ untouched",
      appliesAGitignoreOnlyInsideAAnd,
    );
  });
});

const beforeEachHook2 = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      tempRoot = yield* fs.makeTempDirectory({ prefix: "msa-3303-deep-" });
      yield* fs.makeDirectory(joinPath(tempRoot, "a", "deep"), { recursive: true });
      yield* fs.makeDirectory(joinPath(tempRoot, "b"), { recursive: true });
      yield* fs.writeFileString(joinPath(tempRoot, "a", ".gitignore"), "ignored.txt\n");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "deep", ".gitignore"), "secret.txt\n");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "ignored.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "kept.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "deep", "ignored.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "deep", "secret.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "a", "deep", "kept.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "b", "ignored.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "b", "kept.txt"), "");
      yield* fs.writeFileString(joinPath(tempRoot, "root.txt"), "");
    }),
  );

describe("issue #3303 nested .gitignore rules leak into sibling directories", () => {
  afterEach(afterEachHook);

  describe("deeply nested case", () => {
    beforeEach(beforeEachHook2);
    it("scopes each .gitignore to its own subtree", scopesEachGitignoreToItsOwnSubtree);
  });
});
