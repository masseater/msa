import { Buffer } from "node:buffer";

import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type bashTypes from "../../src/core/tools/bash.types.ts";
import agentSessionBashPersistenceCases1 from "./agent-session-bash-persistence-cases-1.ts";
import harnessModule from "./harness.ts";

const { createHarness } = harnessModule;
const { harnesses } = agentSessionBashPersistenceCases1;

const recordsBashOutputThroughCustomOperations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const operations: bashTypes.BashOperations = {
    exec: (_command, _cwd, options) =>
      runPromise(
        Effect.sync(() => {
          options.onData(Buffer.from("hello from custom ops"));
          return { exitCode: 0 };
        }),
      ),
  };

  const result = yield* Effect.promise(() =>
    harness.session.context.bash.executeBash("custom", undefined, { operations }),
  );

  expect(result.output).toContain("hello from custom ops");
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
});
const streamsBashOutputToTheCallback = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const callbackDeltas: string[] = [];
  const eventUpdates: Array<{ id: string | undefined; delta: string }> = [];
  const unsubscribe = harness.session.subscribe((event) => {
    if (event.type === "bash_execution_update") {
      eventUpdates.push({ delta: event.delta, id: event.id });
    }
  });
  const operations: bashTypes.BashOperations = {
    exec: (_command, _cwd, options) =>
      runPromise(
        Effect.sync(() => {
          options.onData(Buffer.from("hello "));
          options.onData(Buffer.from("world"));
          return { exitCode: 0 };
        }),
      ),
  };

  yield* Effect.promise(() =>
    harness.session.context.bash.executeBash("custom", (delta) => callbackDeltas.push(delta), {
      id: "bash-1",
      operations,
    }),
  );
  unsubscribe();

  expect(callbackDeltas).toEqual(["hello ", "world"]);
  expect(eventUpdates).toEqual([
    { delta: "hello ", id: "bash-1" },
    { delta: "world", id: "bash-1" },
  ]);
});
const runChunks = (entry: {
  chunks: Array<string | Buffer>;
  beforeExit?: (streamed: string) => void;
}): Promise<{ output: string; streamed: string; recorded: string | undefined }> => {
  const { chunks, beforeExit } = entry;
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const harness = yield* Effect.promise(() => createHarness());
      harnesses.push(harness);
      const deltas: string[] = [];
      const operations: bashTypes.BashOperations = {
        exec: (_command, _cwd, options) =>
          runPromise(
            Effect.sync(() => {
              for (const chunk of chunks) {
                options.onData(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
              }
              beforeExit?.(deltas.join(""));
              return { exitCode: 0 };
            }),
          ),
      };
      const result = yield* Effect.promise(() =>
        harness.session.context.bash.executeBash("custom", (delta) => deltas.push(delta), {
          operations,
        }),
      );
      const recorded = harness.session.messages[harness.session.messages.length - 1];
      return {
        output: result.output,
        recorded: recorded?.role === "bashExecution" ? recorded.output : undefined,
        streamed: deltas.join(""),
      };
    }),
  );
};
const stripsAColorResetSplitInside = Effect.gen(function* () {
  const { output, streamed, recorded } = yield* Effect.promise(() =>
    runChunks({ chunks: ["\x1b[31mERROR: file.py:1\x1b[0", "m\n"] }),
  );
  expect(output).toBe("ERROR: file.py:1\n");
  expect(streamed).toBe("ERROR: file.py:1\n");
  expect(recorded).toBe("ERROR: file.py:1\n");
});
const stripsAColorCodeSplitRight = Effect.gen(function* () {
  const { output, streamed } = yield* Effect.promise(() =>
    runChunks({ chunks: ["before\x1b", "[32mafter\n"] }),
  );
  expect(output).toBe("beforeafter\n");
  expect(streamed).toBe("beforeafter\n");
});
const stripsAnOscSequenceSplitBefore = Effect.gen(function* () {
  const { output } = yield* Effect.promise(() =>
    runChunks({ chunks: ["a\x1b]0;window ", "title\x1b", "\\b\n"] }),
  );
  expect(output).toBe("ab\n");
});
const flushesAnIncompleteMultiByteCharacter = Effect.gen(function* () {
  const { output, streamed } = yield* Effect.promise(() =>
    runChunks({ chunks: ["ok", Buffer.from("\u00e9").subarray(0, 1)] }),
  );
  expect(output).toBe("ok\uFFFD");
  expect(streamed).toBe("ok\uFFFD");
});
const doesNotHoldBackOutputBehind = Effect.gen(function* () {
  const long = "x".repeat(300);
  let streamedBeforeExit = "";
  yield* Effect.promise(() =>
    runChunks({
      beforeExit: (streamed) => {
        streamedBeforeExit = streamed;
      },
      chunks: [`\x1b]${long}`],
    }),
  );
  expect(streamedBeforeExit).toBe(`]${long}`);
});

const agentSessionBashPersistenceCases6 = {
  doesNotHoldBackOutputBehind,
  flushesAnIncompleteMultiByteCharacter,
  recordsBashOutputThroughCustomOperations,
  runChunks,
  streamsBashOutputToTheCallback,
  stripsAColorCodeSplitRight,
  stripsAColorResetSplitInside,
  stripsAnOscSequenceSplitBefore,
};

export default agentSessionBashPersistenceCases6;
