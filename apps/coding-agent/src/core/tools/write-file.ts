import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import platform from "../platform/index.ts";
import fileMutationQueue from "./file-mutation-queue.ts";
import pathUtils from "./path-utils.ts";
import type writeTypes from "./write.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { ToolFailure, fromMaybePromise, pathOperations, rethrowCause } = platform;
const { resolveToCwd } = pathUtils;
const { withFileMutationQueue } = fileMutationQueue;

const defaultWriteOperations: writeTypes.WriteOperations = {
  mkdir: (dir) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.makeDirectory(dir, { recursive: true }))),
    ),
  writeFile: (path, content) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
};

const writeUnderQueue = (
  ops: writeTypes.WriteOperations,
  dir: string,
  absolutePath: string,
  content: string,
  path: string,
  signal: AbortSignal | undefined,
) => {
  const throwIfAborted = Effect.suspend(() =>
    signal?.aborted === true
      ? Effect.fail(new ToolFailure({ message: "Operation aborted" }))
      : Effect.void,
  );
  return Effect.gen(function* () {
    yield* throwIfAborted;
    yield* fromMaybePromise(() => ops.mkdir(dir));
    yield* throwIfAborted;
    yield* fromMaybePromise(() => ops.writeFile(absolutePath, content));
    yield* throwIfAborted;
    return {
      content: [{ text: `Successfully wrote to ${path}`, type: "text" as const }],
      details: undefined,
    };
  });
};

interface WriteFileRequest {
  cwd: string;
  path: string;
  content: string;
  ops: writeTypes.WriteOperations;
  signal: AbortSignal | undefined;
}

const writeFile = ({ cwd, path, content, ops, signal }: WriteFileRequest) => {
  const absolutePath = resolveToCwd(path, cwd);
  const dir = pathOperations.dirname(absolutePath);
  return withFileMutationQueue(absolutePath, () =>
    nodeRuntime.runPromise(writeUnderQueue(ops, dir, absolutePath, content, path, signal)),
  );
};

const writeFileModule = { defaultWriteOperations, writeFile };

export default writeFileModule;
