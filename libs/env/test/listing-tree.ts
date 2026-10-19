import { Effect } from "effect";

import { localPath, makeDirectory, writeText } from "./platform.ts";

export const makeTree = (home: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tree = localPath.join(home, "tree");
    for (const file of ["a/b.txt", "a/c/d.txt", ".hidden", "out/x.js", "skip/y.txt", ".git/HEAD"]) {
      yield* makeDirectory(localPath.dirname(localPath.join(tree, file)));
      yield* writeText({ path: localPath.join(tree, file), text: "" });
    }
    yield* makeDirectory(localPath.join(tree, "empty"));
    yield* writeText({ path: localPath.join(tree, ".gitignore"), text: "out/\n" });
  });

export const expectedListing = {
  entries: [
    { path: ".gitignore", kind: "file" },
    { path: ".hidden", kind: "file" },
    { path: "a", kind: "directory" },
    { path: "a/b.txt", kind: "file" },
    { path: "a/c", kind: "directory" },
    { path: "a/c/d.txt", kind: "file" },
    { path: "empty", kind: "directory" },
  ],
  truncated: false,
};
