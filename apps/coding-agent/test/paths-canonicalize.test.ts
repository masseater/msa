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

const returnsTheRealPathForARegular = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const file = joinPath(dir, "file.txt");
      yield* writeTextFile(file, "hello");
      expect(canonicalizePath(file)).toBe(yield* realPath(file));
    }),
  );

const resolvesSymlinksToTheirTargets = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const target = joinPath(dir, "target.txt");
      const link = joinPath(dir, "link.txt");
      yield* writeTextFile(target, "hello");
      yield* symlink(target, link);
      expect(canonicalizePath(link)).toBe(yield* realPath(target));
    }),
  );

const resolvesDirectorySymlinks = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const targetDir = joinPath(dir, "target-dir");
      const linkDir = joinPath(dir, "link-dir");
      yield* makeDirectory(targetDir);
      yield* symlink(targetDir, linkDir);
      expect(canonicalizePath(linkDir)).toBe(yield* realPath(targetDir));
    }),
  );

const fallsBackToTheRawPathWhen = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const nonexistent = joinPath(dir, "no-such-file");
      expect(canonicalizePath(nonexistent)).toBe(nonexistent);
    }),
  );

const fallsBackToTheRawPathFor = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const target = joinPath(dir, "target.txt");
      const link = joinPath(dir, "link.txt");

      yield* symlink(target, link);

      expect(canonicalizePath(link)).toBe(link);
    }),
  );

describe("canonicalizePath", () => {
  it("returns the real path for a regular file", returnsTheRealPathForARegular);

  it("resolves symlinks to their targets", resolvesSymlinksToTheirTargets);

  it("resolves directory symlinks", resolvesDirectorySymlinks);

  it("falls back to the raw path when the target does not exist", fallsBackToTheRawPathWhen);

  it("falls back to the raw path for a dangling symlink", fallsBackToTheRawPathFor);
});
