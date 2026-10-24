import { Effect } from "effect";

import platform from "../platform/index.ts";
import pathUtils from "../tools/path-utils.ts";

const { fromPromise } = platform;
const { pathExists } = pathUtils;

const gitRootOf = (dir: string) =>
  Effect.gen(function* () {
    for (let current = dir; ;) {
      const hasGit = yield* fromPromise(() => pathExists(platform.join(current, ".git")));
      if (hasGit) return current;
      const parent = platform.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  });

const projectNameOf = (dir: string) =>
  gitRootOf(platform.resolve(dir)).pipe(
    Effect.map((root) => (root === undefined ? undefined : platform.basename(root))),
  );

const resolveProjectName = (dir: string): Promise<string> =>
  Effect.runPromise(
    projectNameOf(dir).pipe(Effect.map((name) => name ?? (platform.basename(dir) || dir))),
  );

const memoryProject = {
  resolveProjectName,
};

export default memoryProject;
