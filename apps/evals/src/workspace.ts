import { Effect } from "effect";
import { dual } from "effect/Function";

import { files, pathOperations } from "./platform.ts";

const seedFile = (workspace: string, name: string, content: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (name === "" || pathOperations.isAbsolute(name)) {
      return yield* Effect.die(new TypeError(`Invalid workspace fixture path: ${name}`));
    }
    const path = pathOperations.resolve(workspace, name);
    const pathFromWorkspace = pathOperations.relative(workspace, path);
    if (
      pathFromWorkspace === ".." ||
      pathFromWorkspace.startsWith(`..${pathOperations.separator}`) ||
      pathOperations.isAbsolute(pathFromWorkspace)
    ) {
      return yield* Effect.die(new TypeError(`Workspace fixture escapes the workspace: ${name}`));
    }
    yield* files.makeDirectory(pathOperations.dirname(path));
    yield* files.writeFileString(path, content, 0o600);
  });

export const seedWorkspace: {
  (
    fixtures: Readonly<Record<string, string>> | undefined,
  ): (workspace: string) => Effect.Effect<void>;
  (workspace: string, fixtures: Readonly<Record<string, string>> | undefined): Effect.Effect<void>;
} = dual(
  2,
  (
    workspace: string,
    fixtures: Readonly<Record<string, string>> | undefined,
  ): Effect.Effect<void> =>
    Effect.forEach(
      Object.entries(fixtures ?? {}),
      ([name, content]) => seedFile(workspace, name, content),
      { discard: true },
    ),
);
