import { Effect } from "effect";

import envConformanceExec from "./env-conformance-exec.ts";
import envConformanceList from "./env-conformance-list.ts";
import envConformanceReaders from "./env-conformance-readers.ts";
import type envConformanceSupportTypes from "./env-conformance-support.types.ts";
import envConformanceWatch from "./env-conformance-watch.ts";
import type typesModule from "./types.ts";

const { followSymlinks, readerCases } = envConformanceReaders;
const { watchCases, watchedSymlink } = envConformanceWatch;
const { execCases } = envConformanceExec;
const { listCases, listedSymlinks } = envConformanceList;

const selectedCases = (
  options: typesModule.EnvConformanceOptions,
): readonly envConformanceSupportTypes.EnvCaseSpec[] => {
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

function createEnvConformance(
  options: typesModule.EnvConformanceOptions,
): readonly typesModule.EnvConformanceCase[] {
  const suite: envConformanceSupportTypes.EnvSuite = {
    assert: options.assertions,
    shell: options.shell ?? ["sh", "-c"],
  };
  return selectedCases(options).map(({ name, timeoutMs, test }): typesModule.EnvConformanceCase => {
    const run = () => options.withEnv((env) => Effect.runPromise(test(env, suite)));
    return timeoutMs === undefined ? { name, run } : { name, run, timeoutMs };
  });
}

const envConformance = {
  createEnvConformance,
};

export default envConformance;
