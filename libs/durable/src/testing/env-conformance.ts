import { Effect } from "effect";

import { execCases } from "./env-conformance-exec.ts";
import { listCases, listedSymlinks } from "./env-conformance-list.ts";
import { followSymlinks, readerCases } from "./env-conformance-readers.ts";
import type { EnvCaseSpec, EnvSuite } from "./env-conformance-support.ts";
import { watchCases, watchedSymlink } from "./env-conformance-watch.ts";
import type { EnvConformanceCase, EnvConformanceOptions } from "./types.ts";

const selectedCases = (options: EnvConformanceOptions): readonly EnvCaseSpec[] => {
  const symlinks = options.symlinks ?? true;
  const listFiles = options.listFiles === true;
  return [
    ...readerCases,
    ...watchCases,
    ...execCases,
    ...(listFiles ? listCases : []),
    ...(symlinks && listFiles ? [listedSymlinks] : []),
    ...(symlinks ? [followSymlinks, watchedSymlink] : []),
  ];
};

export function createEnvConformance(
  options: EnvConformanceOptions,
): readonly EnvConformanceCase[] {
  const suite: EnvSuite = { assert: options.assertions, shell: options.shell ?? ["sh", "-c"] };
  return selectedCases(options).map(({ name, timeoutMs, test }): EnvConformanceCase => {
    const run = () => options.withEnv((env) => Effect.runPromise(test(env, suite)));
    return timeoutMs === undefined ? { name, run } : { name, timeoutMs, run };
  });
}
