import { NodeServices } from "@effect/platform-node";
import { Data, Effect, FileSystem, Path, Schema } from "effect";
import { parse } from "yaml";

import { runMainWith } from "./run-main.ts";

const PROJECT_ROOTS: readonly string[] = ["apps", "libs", "infra", "tools"];
const WORKSPACE_ENTRIES_OUTSIDE_ROOTS: readonly string[] = [".claude"];

const Workspace = Schema.Struct({ packages: Schema.Array(Schema.String) });

class LayoutError extends Data.TaggedError("LayoutError")<{ readonly message: string }> {}

const isProjectPath = (entry: string): boolean =>
  PROJECT_ROOTS.some((root) => entry.startsWith(`${root}/`)) ||
  WORKSPACE_ENTRIES_OUTSIDE_ROOTS.includes(entry);

const isScannedTopLevel = (name: string): boolean =>
  !name.startsWith(".") && name !== "node_modules" && !PROJECT_ROOTS.includes(name);

const program = Effect.gen(function* () {
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  const fs = yield* FileSystem.FileSystem;
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..");

  const strayWorkspaceEntries = Effect.gen(function* () {
    const workspace = yield* Schema.decodeUnknownEffect(Workspace)(
      parse(yield* fs.readFileString(path.join(root, "pnpm-workspace.yaml"))),
    );
    return workspace.packages
      .filter((entry) => !isProjectPath(entry))
      .map((entry) => `pnpm-workspace.yaml: ${entry}`);
  });

  const manifestsBelow = (name: string) =>
    Effect.gen(function* () {
      const children = yield* fs.readDirectory(path.join(root, name));
      const manifests = children.map((child) => `${name}/${child}/package.json`);
      return yield* Effect.filter(manifests, (manifest) =>
        fs.exists(path.join(root, manifest)).pipe(Effect.orElseSucceed(() => false)),
      );
    });

  const strayProjects = Effect.gen(function* () {
    const names = (yield* fs.readDirectory(root)).filter(isScannedTopLevel);
    const directories = yield* Effect.filter(names, (name) =>
      fs.stat(path.join(root, name)).pipe(Effect.map((info) => info.type === "Directory")),
    );
    const nested = yield* Effect.forEach(directories, manifestsBelow);
    const packagesDir = (yield* fs.exists(path.join(root, "packages"))) ? ["packages/"] : [];
    return [...packagesDir, ...nested.flat()];
  });

  const problems = [...(yield* strayWorkspaceEntries), ...(yield* strayProjects)];
  if (problems.length > 0) {
    return yield* new LayoutError({
      message: `Projects must live under ${PROJECT_ROOTS.join("/, ")}/:\n${problems.join("\n")}`,
    });
  }
});

// oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
runMainWith(program, NodeServices.layer);
