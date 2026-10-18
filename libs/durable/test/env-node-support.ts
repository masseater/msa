import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { vi } from "vite-plus/test";

import { type ShellExecOptions } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { awaited } from "./effect-support.ts";
import { makeTempDir, removeDirRetrying, restoreWritable } from "./platform-support.ts";

export const tempDirs: string[] = [];

export const chmodRestorePaths: string[] = [];

export const createTempDir: Effect.Effect<string> = makeTempDir("msa-durable-env-").pipe(
  Effect.tap((dir) => Effect.sync(() => tempDirs.push(dir))),
);

export const removeTempDir = removeDirRetrying;

export const cleanUpEnvTests: Effect.Effect<void> = Effect.gen(function* () {
  vi.restoreAllMocks();
  yield* Effect.forEach(chmodRestorePaths.splice(0), restoreWritable, { discard: true });
  yield* Effect.forEach(tempDirs.splice(0), removeTempDir, { discard: true });
});

export function abortedContext() {
  const controller = new AbortController();
  controller.abort();
  return withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
}

export interface NodeFileHandle {
  readonly fd: number;
  sync(): Promise<void>;
  read(...args: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}

type FsPromises = {
  open(path: string, flags: string): Promise<NodeFileHandle>;
};

const nodeFsPromises = (): FsPromises =>
  (process.getBuiltinModule as (id: string) => unknown)("node:fs/promises") as FsPromises;

export const fileHandlePrototype = Effect.fn("fileHandlePrototype")(function* (path: string) {
  const handle = yield* awaited(nodeFsPromises().open(path, "r"));
  yield* awaited(handle.close());
  return Object.getPrototypeOf(handle) as NodeFileHandle;
});

function collectShellOutputImpl(
  env: NodeExecutionEnv,
  command: string,
  options: ShellExecOptions | undefined,
  context: Parameters<NodeExecutionEnv["exec"]>[2],
): Promise<{ result: Awaited<ReturnType<NodeExecutionEnv["exec"]>>; output: string }> {
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
      return { result, output };
    }),
  );
}

export const collectShellOutput: {
  (
    command: string,
    options: ShellExecOptions | undefined,
    context: Parameters<NodeExecutionEnv["exec"]>[2],
  ): (env: NodeExecutionEnv) => ReturnType<typeof collectShellOutputImpl>;
  (
    env: NodeExecutionEnv,
    command: string,
    options: ShellExecOptions | undefined,
    context: Parameters<NodeExecutionEnv["exec"]>[2],
  ): ReturnType<typeof collectShellOutputImpl>;
} = dual(4, collectShellOutputImpl);

export function toBashSingleQuotedArg(value: string): string {
  return `'${value.replace(/\\/gu, "/").replace(/'/gu, `'"'"'`)}'`;
}
