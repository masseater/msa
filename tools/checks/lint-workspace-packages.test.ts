import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { expect, it } from "vite-plus/test";

import rootTsconfig from "../../tsconfig.json" with { type: "json" };
import lintedPackages from "../oxlint/workspace-packages.json" with { type: "json" };
import workspacePackages from "./workspace-packages.ts";

const { loadWorkspaces } = workspacePackages;

const exportSubpaths = (name: string, exports: object | undefined): readonly string[] =>
  Object.keys(exports ?? {})
    .filter((key) => key.startsWith("./"))
    .map((key) => `${name}/${key.slice(2)}`);

const aliasesInto = (dir: string): readonly string[] =>
  Object.entries(rootTsconfig.compilerOptions.paths)
    .filter(([, targets]) => targets.some((target) => target.startsWith(`./${dir}/`)))
    .map(([specifier]) => specifier);

const expectedPackages = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const workspaces = yield* loadWorkspaces(
    {
      isFile: (file) => fs.exists(file).pipe(Effect.orElseSucceed(() => false)),
      list: (dir) => fs.readDirectory(dir).pipe(Effect.orElseSucceed((): readonly string[] => [])),
      path,
      read: (file) => fs.readFileString(file).pipe(Effect.orDie),
    },
    root,
  );
  return workspaces
    .filter((workspace) => workspace.dir !== root)
    .map((workspace) => {
      const dir = path.relative(root, workspace.dir);
      const { name } = workspace;
      return {
        dir,
        specifiers: [
          ...new Set([
            name,
            `${name}/*`,
            ...exportSubpaths(name, workspace.exports),
            ...aliasesInto(dir),
          ]),
        ],
      };
    })
    .toSorted((left, right) => left.dir.localeCompare(right.dir));
});

const runtime = ManagedRuntime.make(NodeServices.layer);

it("lists every workspace package with the specifiers that import it", () =>
  runtime.runPromise(expectedPackages).then((expected) => {
    expect(lintedPackages).toEqual(expected);
    return undefined;
  }));
