import testing from "@msa/testing";
import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vite-plus/test";

import paths from "../src/utils/paths.ts";
import tempDirFixture from "./temp-dir-fixture.ts";

const { canonicalizePath } = paths;
const { useTempDir } = tempDirFixture;

const { joinPath, makeDirectory, provideNode, runTest, runTestSync, writeTextFile } = testing;

const fileSystem = runTestSync(provideNode(FileSystem.FileSystem.useSync((service) => service)));

const realPath = (file: string): Effect.Effect<string> => Effect.orDie(fileSystem.realPath(file));

const symlink = (from: string, to: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.symlink(from, to));

const createTempDir = useTempDir("msa-paths-");

interface Arranged {
  readonly input: string;
  readonly target?: string;
}

const canonicalizeCases: {
  readonly arrange: (dir: string) => Effect.Effect<Arranged>;
  readonly name: string;
}[] = [
  {
    arrange: (dir) =>
      Effect.gen(function* () {
        const file = joinPath(dir, "file.txt");
        yield* writeTextFile(file, "hello");
        return { input: file, target: file };
      }),
    name: "returns the real path for a regular file",
  },
  {
    arrange: (dir) =>
      Effect.gen(function* () {
        const target = joinPath(dir, "target.txt");
        const link = joinPath(dir, "link.txt");
        yield* writeTextFile(target, "hello");
        yield* symlink(target, link);
        return { input: link, target };
      }),
    name: "resolves symlinks to their targets",
  },
  {
    arrange: (dir) =>
      Effect.gen(function* () {
        const targetDir = joinPath(dir, "target-dir");
        const linkDir = joinPath(dir, "link-dir");
        yield* makeDirectory(targetDir);
        yield* symlink(targetDir, linkDir);
        return { input: linkDir, target: targetDir };
      }),
    name: "resolves directory symlinks",
  },
  {
    arrange: (dir) => Effect.succeed({ input: joinPath(dir, "no-such-file") }),
    name: "falls back to the raw path when the target does not exist",
  },
  {
    arrange: (dir) =>
      Effect.gen(function* () {
        const link = joinPath(dir, "link.txt");
        yield* symlink(joinPath(dir, "target.txt"), link);
        return { input: link };
      }),
    name: "falls back to the raw path for a dangling symlink",
  },
];

describe("canonicalizePath", () => {
  it.each(canonicalizeCases)("$name", ({ arrange }) =>
    runTest(
      Effect.gen(function* () {
        const { input, target } = yield* Effect.flatMap(createTempDir, arrange);
        const expected = target === undefined ? input : yield* realPath(target);
        expect(yield* Effect.promise(() => canonicalizePath(input))).toBe(expected);
      }),
    ),
  );
});
