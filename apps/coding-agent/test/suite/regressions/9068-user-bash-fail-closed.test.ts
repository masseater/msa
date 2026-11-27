import testing from "@msa/testing";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../../../src/core/extensions/types.types.ts";
import rpcMode from "../../../src/modes/rpc/rpc-mode.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
import UserBashFailClosedSupport from "./9068-user-bash-fail-closed-support.ts";
import rpcRuntimeSupport from "./rpc-runtime-support.ts";

const {
  createRuntimeHost,
  parseOutputLines,
  resetRpcIo,
  restoreListeners,
  rpcIo,
  takeListenerSnapshot,
} = rpcRuntimeSupport;

const { awaited, runTest } = testing;

const { runRpcMode } = rpcMode;

const { localResult } = UserBashFailClosedSupport;

const { createHarness } = harnessModule;

vi.mock("../../../src/core/output-guard.js", () =>
  import("./rpc-runtime-support.ts").then((module) => module.default.outputGuardModule),
);

vi.mock("../../../src/modes/interactive/theme/theme.js", () => ({ default: { theme: {} } }));

vi.mock("../../../src/modes/interactive/components/bash-execution.js", () => ({
  default: {
    BashExecutionComponent: class {
      appendOutput(): void {}
      setComplete(): void {}
    },
  },
}));

vi.mock("../../../src/modes/rpc/jsonl.js", () =>
  import("./rpc-runtime-support.ts").then((module) => module.default.jsonlModule),
);

function startRpcHarness(extension: (msa: extensionsTypesTypes.ExtensionAPI) => void): Promise<{
  harness: harnessTypes.Harness;
  send(command: Record<string, unknown>): void;
  cleanup(): Promise<void>;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const listenerSnapshot = takeListenerSnapshot();
      const harness = yield* Effect.promise(() =>
        createHarness({ extensionFactories: [extension] }),
      );
      const cleanup = () => {
        const closing = harness.cleanup();
        return runTest(
          awaited(closing).pipe(
            Effect.ensuring(Effect.sync(() => restoreListeners(listenerSnapshot))),
          ),
        );
      };

      {
        const tryExit7 = yield* Effect.exit(
          Effect.gen(function* () {
            void runRpcMode(createRuntimeHost(harness));
            yield* Effect.promise(() => vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined()));
          }),
        );
        if (Exit.isFailure(tryExit7)) {
          const error = Cause.squash(tryExit7.cause);
          yield* awaited(cleanup());
          throw error;
        }
      }

      return {
        cleanup,
        harness,
        send(command) {
          if (rpcIo.lineHandler === undefined) throw new Error("RPC line handler is not attached");
          rpcIo.lineHandler(JSON.stringify(command));
        },
      };
    }),
  );
}

const rpcCases: Array<{
  name: string;
  extension: (msa: extensionsTypesTypes.ExtensionAPI) => void;
  error?: string;
  executeCount: number;
}> = [
  {
    error: "Routing failed",
    executeCount: 0,
    extension: (msa) => {
      msa.on("user_bash", () =>
        Effect.runPromise(
          Effect.sync(() => {
            throw new Error("Routing failed");
          }),
        ),
      );
    },
    name: "fails the request without executing bash when a handler throws",
  },
  {
    error: "Invalid user_bash handler result",
    executeCount: 0,
    extension: (msa) => {
      msa.on("user_bash", () =>
        Promise.resolve({} as unknown as extensionsTypesTypes.UserBashEventResult),
      );
    },
    name: "fails the request without executing bash when a handler returns an empty result",
  },
  {
    executeCount: 1,
    extension: (msa) => {
      msa.on("user_bash", () => Promise.resolve(undefined));
    },
    name: "executes bash normally when a handler returns undefined",
  },
];

afterEach(() => {
  resetRpcIo();
});

describe("RPC user_bash failure handling (#9068)", () => {
  test.each(rpcCases)("$name", ({ extension, error, executeCount }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* Effect.promise(() => startRpcHarness(extension));
        const executeBash = vi
          .spyOn(rpc.harness.session.context.bash, "executeBash")
          .mockResolvedValue(localResult);

        try {
          rpc.send({ command: "pwd", id: "bash-request", type: "bash" });

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const response = parseOutputLines().find(
                (output) => output["type"] === "response" && output["id"] === "bash-request",
              );
              expect(response).toMatchObject({
                command: "bash",
                id: "bash-request",
                success: error === undefined,
                type: "response",
                ...(error !== undefined && error !== ""
                  ? { error: expect.stringContaining(error) }
                  : { data: localResult }),
              });
            }),
          );

          if (error !== undefined && error !== "") {
            expect(parseOutputLines()).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  error: expect.stringContaining(error),
                  event: "user_bash",
                  type: "extension_error",
                }),
              ]),
            );
          }
          expect(executeBash).toHaveBeenCalledTimes(executeCount);
        } finally {
          executeBash.mockRestore();
          yield* awaited(rpc.cleanup());
        }
      }),
    ),
  );
});
