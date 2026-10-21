import { Effect } from "effect";

import platform from "./platform.ts";

const { localPath, makeDirectory, writeText } = platform;

const makeTree = (home: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tree = localPath.join(home, "tree");
    for (const file of ["a/b.txt", "a/c/d.txt", ".hidden", "out/x.js", "skip/y.txt", ".git/HEAD"]) {
      yield* makeDirectory(localPath.dirname(localPath.join(tree, file)));
      yield* writeText({ path: localPath.join(tree, file), text: "" });
    }
    yield* makeDirectory(localPath.join(tree, "empty"));
    yield* writeText({ path: localPath.join(tree, ".gitignore"), text: "out/\n" });
  });

const expectedListing = {
  entries: [
    { kind: "file", path: ".gitignore" },
    { kind: "file", path: ".hidden" },
    { kind: "directory", path: "a" },
    { kind: "file", path: "a/b.txt" },
    { kind: "directory", path: "a/c" },
    { kind: "file", path: "a/c/d.txt" },
    { kind: "directory", path: "empty" },
  ],
  truncated: false,
};

const listingTree = {
  expectedListing,
  makeTree,
};

export default listingTree;
