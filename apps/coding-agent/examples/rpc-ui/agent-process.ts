import { NodeServices } from "@effect/platform-node";
import { Effect, ManagedRuntime, Queue, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type agentProcessTypes from "./agent-process.types.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);

const spawnAgent = (
  options: agentProcessTypes.AgentOptions,
  outbound: Queue.Queue<string>,
  state: agentProcessTypes.AgentState,
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(options.command, [...options.args], {
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      }),
    );

    yield* handle.stdout.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.runForEach((line) => Effect.sync(() => options.onLine(line))),
      Effect.forkScoped,
    );
    yield* handle.stderr.pipe(
      Stream.decodeText,
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          state.stderrText += chunk;
        }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.forkScoped(
      Stream.run(
        Stream.fromQueue(outbound).pipe(Stream.map((line) => new TextEncoder().encode(line))),
        handle.stdin,
      ),
    );

    const exitCode = yield* handle.exitCode;
    state.running = false;
    options.onExit(Number(exitCode));
  });

const startAgent = (options: agentProcessTypes.AgentOptions): agentProcessTypes.AgentHandle => {
  const outbound = Effect.runSync(Queue.unbounded<string>());
  const state: agentProcessTypes.AgentState = { running: true, stderrText: "" };

  runtime.runFork(Effect.scoped(spawnAgent(options, outbound, state)).pipe(Effect.ignore));

  return {
    isRunning: () => state.running,
    send: (message) => {
      Queue.offerUnsafe(outbound, `${JSON.stringify(message)}\n`);
    },
    stderrText: () => state.stderrText,
  };
};

const agentProcess = {
  startAgent,
};

export default agentProcess;
