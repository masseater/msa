import { Effect } from "effect";

import { fromPromise, pathOperations, platformRuntime } from "../platform/index.ts";
import { pathExists } from "../tools/path-utils.ts";

const gitRootOf = (dir: string) =>
  Effect.gen(function* () {
    for (let current = dir; ;) {
      const hasGit = yield* fromPromise(() => pathExists(pathOperations.join(current, ".git")));
      if (hasGit) return current;
      const parent = pathOperations.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  });

export const projectNameOf = (dir: string) =>
  gitRootOf(pathOperations.resolve(dir)).pipe(
    Effect.map((root) => (root === undefined ? undefined : pathOperations.basename(root))),
  );

export const resolveProjectName = (dir: string): Promise<string> =>
  platformRuntime.runPromise(
    projectNameOf(dir).pipe(Effect.map((name) => name ?? (pathOperations.basename(dir) || dir))),
  );
