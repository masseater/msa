import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { vi } from "vite-plus/test";

import type envTypes from "../src/env/index.types.ts";
import type nodeTypes from "../src/env/node.types.ts";
import effectSupport from "./effect-support.ts";
import type envNodeSupportTypes from "./env-node-support.types.ts";
import nodeFsPromisesCapture from "./node-fs-promises-capture.ts";
import platformSupport from "./platform-support.ts";

const { BACKGROUND_CONTEXT, withAbortSignal } = contextModule;

const { awaited } = effectSupport;
const { openFile } = nodeFsPromisesCapture;
const { makeTempDir, removeDirRetrying, restoreWritable } = platformSupport;

const tempDirs: string[] = [];

const chmodRestorePaths: string[] = [];

const createTempDir: Effect.Effect<string> = makeTempDir("msa-durable-env-").pipe(
  Effect.tap((dir) => Effect.sync(() => tempDirs.push(dir))),
);

const removeTempDir = removeDirRetrying;

const cleanUpEnvTests: Effect.Effect<void> = Effect.gen(function* () {
  vi.restoreAllMocks();
  yield* Effect.forEach(chmodRestorePaths.splice(0), restoreWritable, { discard: true });
  yield* Effect.forEach(tempDirs.splice(0), removeTempDir, { discard: true });
});

function abortedContext() {
  const controller = new AbortController();
  controller.abort();
  return withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
}

const fileHandlePrototype = Effect.fn("fileHandlePrototype")(function* (path: string) {
  const handle = yield* awaited(openFile(path, "r"));
  yield* awaited(handle.close());
  return Object.getPrototypeOf(handle) as envNodeSupportTypes.NodeFileHandle;
});

function collectShellOutputImpl(
  env: nodeTypes.NodeExecutionEnv,
  command: string,
  options: envTypes.ShellExecOptions | undefined,
  context: Parameters<nodeTypes.NodeExecutionEnv["exec"]>[2],
): Promise<{ result: Awaited<ReturnType<nodeTypes.NodeExecutionEnv["exec"]>>; output: string }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let output = "";
      const result = yield* awaited(
        env.exec(
          command,
          {
            ...options,
            onOutput: (text) => {
              output += text;
            },
          },
          context,
        ),
      );
      return { output, result };
    }),
  );
}

const collectShellOutput: {
  (
    command: string,
    options: envTypes.ShellExecOptions | undefined,
    context: Parameters<nodeTypes.NodeExecutionEnv["exec"]>[2],
  ): (env: nodeTypes.NodeExecutionEnv) => ReturnType<typeof collectShellOutputImpl>;
  (
    env: nodeTypes.NodeExecutionEnv,
    command: string,
    options: envTypes.ShellExecOptions | undefined,
    context: Parameters<nodeTypes.NodeExecutionEnv["exec"]>[2],
  ): ReturnType<typeof collectShellOutputImpl>;
} = dual(4, collectShellOutputImpl);

function toBashSingleQuotedArg(value: string): string {
  return `'${value.replace(/\\/gu, "/").replace(/'/gu, `'"'"'`)}'`;
}

const envNodeSupport = {
  abortedContext,
  chmodRestorePaths,
  cleanUpEnvTests,
  collectShellOutput,
  createTempDir,
  fileHandlePrototype,
  removeTempDir,
  tempDirs,
  toBashSingleQuotedArg,
};

export default envNodeSupport;
