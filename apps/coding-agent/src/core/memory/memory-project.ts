import { Effect } from "effect";

import platform from "../platform/index.ts";
import pathUtils from "../tools/path-utils.ts";

const { fromPromise, pathOperations } = platform;
const { pathExists } = pathUtils;

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

const projectNameOf = (dir: string) =>
  gitRootOf(pathOperations.resolve(dir)).pipe(
    Effect.map((root) => (root === undefined ? undefined : pathOperations.basename(root))),
  );

const resolveProjectName = (dir: string): Promise<string> =>
  Effect.runPromise(
    projectNameOf(dir).pipe(Effect.map((name) => name ?? (pathOperations.basename(dir) || dir))),
  );

const memoryProject = {
  projectNameOf,
  resolveProjectName,
};

export default memoryProject;
