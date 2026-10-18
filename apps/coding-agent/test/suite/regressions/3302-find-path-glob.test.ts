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
        .filter((l) => l.length > 0 && !l.startsWith("["));
    }),
  );
}

const basenamePatternStillMatchesRegressionSafe = Effect.gen(function* () {
  const files = yield* Effect.promise(() => runFind("*.spec.ts"));
  expect(files.sort()).toEqual(["some/parent/child/test.spec.ts", "src/foo/bar/example.spec.ts"]);
});

const directoryPrefixedPatternWithTailMatches = Effect.gen(function* () {
  const files = yield* Effect.promise(() => runFind("some/parent/child/**"));

  expect(files).toContain("some/parent/child/file.ext");
  expect(files).toContain("some/parent/child/test.spec.ts");
});

const leadingWildcardWithPathSegmentsMatches = Effect.gen(function* () {
  const files = yield* Effect.promise(() => runFind("**/parent/child/*"));
  expect(files.sort()).toContain("some/parent/child/file.ext");
  expect(files.sort()).toContain("some/parent/child/test.spec.ts");
});

const srcSpecTsMatchesNestedSpec = Effect.gen(function* () {
  const files = yield* Effect.promise(() => runFind("src/**/*.spec.ts"));
  expect(files).toEqual(["src/foo/bar/example.spec.ts"]);
});

describe("issue #3302 find returns no results for path-based glob patterns", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempRoot = yield* fs.makeTempDirectory({ prefix: "msa-3302-" });
        yield* fs.makeDirectory(join(tempRoot, "some", "parent", "child"), { recursive: true });
        yield* fs.makeDirectory(join(tempRoot, "src", "foo", "bar"), { recursive: true });
        yield* fs.writeFileString(join(tempRoot, "some", "parent", "child", "file.ext"), "");
        yield* fs.writeFileString(join(tempRoot, "some", "parent", "child", "test.spec.ts"), "");
        yield* fs.writeFileString(join(tempRoot, "src", "foo", "bar", "example.spec.ts"), "");
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempRoot, { recursive: true, force: true })));
  it("basename pattern still matches (regression-safe)", () =>
    Effect.runPromise(basenamePatternStillMatchesRegressionSafe));
  it("directory-prefixed pattern with ** tail matches subtree", () =>
    Effect.runPromise(directoryPrefixedPatternWithTailMatches));
  it("leading ** wildcard with path segments matches", () =>
    Effect.runPromise(leadingWildcardWithPathSegmentsMatches));
  it("src/**/*.spec.ts matches nested spec file", () =>
    Effect.runPromise(srcSpecTsMatchesNestedSpec));
});
