import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const makeTree = (home: string): void => {
  const tree = join(home, "tree");
  for (const file of ["a/b.txt", "a/c/d.txt", ".hidden", "out/x.js", "skip/y.txt", ".git/HEAD"]) {
    mkdirSync(join(tree, file, ".."), { recursive: true });
    writeFileSync(join(tree, file), "");
  }
  mkdirSync(join(tree, "empty"));
  writeFileSync(join(tree, ".gitignore"), "out/\n");
};

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
