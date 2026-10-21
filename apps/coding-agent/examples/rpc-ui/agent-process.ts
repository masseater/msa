import { NodeServices } from "@effect/platform-node";
import { Effect, ManagedRuntime, Queue, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type agentProcessTypes from "./agent-process.types.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);

const startAgent = (options: agentProcessTypes.AgentOptions): agentProcessTypes.AgentHandle => {
  const outbound = Effect.runSync(Queue.unbounded<string>());
  let stderrText = "";
  let running = true;

  const program = Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(options.command, [...options.args], {
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      }),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(Stream.splitLines(Stream.decodeText(handle.stdout)), (line) =>
        Effect.sync(() => options.onLine(line)),
      ),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.decodeText(handle.stderr), (chunk) =>
        Effect.sync(() => {
          stderrText += chunk;
        }),
      ),
    );
    yield* Effect.forkScoped(
      Stream.run(
        Stream.fromQueue(outbound).pipe(Stream.map((line) => new TextEncoder().encode(line))),
        handle.stdin,
      ),
    );

    const exitCode = yield* handle.exitCode;
    running = false;
    options.onExit(Number(exitCode));
  });

  runtime.runFork(Effect.scoped(program).pipe(Effect.ignore));

  return {
    isRunning: () => running,
    send: (message) => {
      Queue.offerUnsafe(outbound, `${JSON.stringify(message)}\n`);
    },
    stderrText: () => stderrText,
  };
};

const agentProcess = {
  startAgent,
};

export default agentProcess;
