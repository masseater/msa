import { Effect } from "effect";

import platform from "../platform/index.ts";
import findFd from "./find-fd.ts";
import findSupport from "./find-support.ts";
import type findTypes from "./find.types.ts";
import pathUtils from "./path-utils.ts";

const { DEFAULT_FIND_LIMIT, globWithOperations } = findSupport;
const { resolveToCwd } = pathUtils;
const { abortedBy, nonEmptyOr, unwrapForeign } = platform;
const { globWithFd } = findFd;

interface FindCall {
  cwd: string;
  input: findTypes.FindToolInput;
  ops: findTypes.FindOperations | undefined;
  signal: AbortSignal | undefined;
}

const searchFiles = ({ cwd, input, ops, signal }: FindCall) => {
  const request = {
    effectiveLimit: input.limit ?? DEFAULT_FIND_LIMIT,
    pattern: input.pattern,
    searchPath: resolveToCwd(nonEmptyOr(input.path, "."), cwd),
  };
  const search = ops?.glob === undefined ? globWithFd(request) : globWithOperations(ops, request);
  return Effect.runPromise(unwrapForeign(search.pipe(abortedBy(signal))));
};

const findSearch = { searchFiles };

export default findSearch;
