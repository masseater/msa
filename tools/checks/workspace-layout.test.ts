import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const PROJECT_ROOTS: ReadonlyArray<string> = ["apps", "libs", "infra", "tools"];
const WORKSPACE_ENTRIES_OUTSIDE_ROOTS: ReadonlyArray<string> = [".claude"];

const Workspace = Schema.Struct({ packages: Schema.Array(Schema.String) });

const isProjectPath = (entry: string): boolean =>
  PROJECT_ROOTS.some((root) => entry.startsWith(`${root}/`)) ||
  WORKSPACE_ENTRIES_OUTSIDE_ROOTS.includes(entry);

const isScannedTopLevel = (name: string): boolean =>
  !name.startsWith(".") && name !== "node_modules" && !PROJECT_ROOTS.includes(name);

const manifestsBelow = (root: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifests = (yield* fs.readDirectory(path.join(root, name))).map(
      (child) => `${name}/${child}/package.json`,
    );
    return yield* Effect.filter(manifests, (manifest) =>
      fs.exists(path.join(root, manifest)).pipe(Effect.orElseSucceed(() => false)),
    );
  });

const collectProblems = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const workspace = yield* Schema.decodeUnknownEffect(Workspace)(
    parse(yield* fs.readFileString(path.join(root, "pnpm-workspace.yaml"))),
  );
  const strayWorkspaceEntries = workspace.packages
    .filter((entry) => !isProjectPath(entry))
    .map((entry) => `pnpm-workspace.yaml: ${entry}`);
  const names = (yield* fs.readDirectory(root)).filter(isScannedTopLevel);
  const directories = yield* Effect.filter(names, (name) =>
    fs.stat(path.join(root, name)).pipe(Effect.map((info) => info.type === "Directory")),
  );
  const nested = yield* Effect.forEach(directories, (name) => manifestsBelow(root, name));
  const packagesDir = (yield* fs.exists(path.join(root, "packages"))) ? ["packages/"] : [];
  return [...strayWorkspaceEntries, ...packagesDir, ...nested.flat()];
});

const runtime = ManagedRuntime.make(NodeServices.layer);

const checkLayout = collectProblems.pipe(
  Effect.tap((problems) => Effect.sync(() => expect(problems).toEqual([]))),
);

it("keeps every workspace package under apps/, libs/, infra/, or tools/", () =>
  runtime.runPromise(checkLayout));
