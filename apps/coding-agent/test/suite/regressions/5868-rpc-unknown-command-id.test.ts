import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import rpcMode from "../../../src/modes/rpc/rpc-mode.ts";
import harnessModule from "../harness.ts";
import rpcRuntimeSupport from "./rpc-runtime-support.ts";

const {
  createRuntimeHost,
  parseOutputLines,
  resetRpcIo,
  restoreListeners,
  rpcIo,
  takeListenerSnapshot,
} = rpcRuntimeSupport;

const { runRpcMode } = rpcMode;

const { createHarness } = harnessModule;

const { awaited, toJsonText } = testing;

vi.mock("../../../src/core/output-guard.js", () =>
  import("./rpc-runtime-support.ts").then((module) => module.default.outputGuardModule),
);

vi.mock("../../../src/modes/interactive/theme/theme.js", () => ({ default: { theme: {} } }));

vi.mock("../../../src/modes/rpc/jsonl.js", () =>
  import("./rpc-runtime-support.ts").then((module) => module.default.jsonlModule),
);

const preservesTheRequestIdOnUnknown = Effect.gen(function* () {
  const listenerSnapshot = takeListenerSnapshot();
  const harness = yield* Effect.promise(() => createHarness());

  try {
    void runRpcMode(createRuntimeHost(harness));
    yield* Effect.promise(() => vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined()));

    rpcIo.lineHandler?.(yield* toJsonText({ id: "test", type: "foobar" }));

    yield* Effect.promise(() =>
      vi.waitFor(() => {
        expect(parseOutputLines()).toContainEqual({
          command: "foobar",
          error: "Unknown command: foobar",
          id: "test",
          success: false,
          type: "response",
        });
      }),
    );
  } finally {
    yield* awaited(harness.cleanup());
    restoreListeners(listenerSnapshot);
  }
});

const preservesTheRequestIdOnUnknownCommand = () =>
  Effect.runPromise(preservesTheRequestIdOnUnknown);

describe("RPC unknown command responses (#5868)", () => {
  afterEach(() => {
    resetRpcIo();
  });
  test("preserves the request id on unknown command errors", preservesTheRequestIdOnUnknownCommand);
});
