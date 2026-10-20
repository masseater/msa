import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, ManagedRuntime, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type commandTypes from "./command.types.ts";
import ToolFailure from "./tool-failure.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const collect = (request: commandTypes.CommandRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make(request.file, [...request.args], {
          stdin: "ignore",
          ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        }),
      );
      const [lines, stderr, exitCode] = yield* Effect.all(
        [
          Stream.runCollect(Stream.splitLines(Stream.decodeText(handle.stdout))),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );
      return { exitCode, lines, stderr };
    }),
  );

const runCommand = (request: commandTypes.CommandRequest): Promise<commandTypes.CommandOutput> =>
  nodeRuntime.runPromise(
    collect(request).pipe(
      Effect.mapError(
        (error) =>
          new ToolFailure({
            cause: error,
            message: `Failed to run ${request.file}: ${error.message}`,
          }),
      ),
    ),
    request.signal === undefined ? undefined : { signal: request.signal },
  );

const streamLines = (request: commandTypes.StreamRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make(request.file, [...request.args], {
          stdin: "ignore",
          ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        }),
      );
      const stderrFiber = yield* Stream.mkString(Stream.decodeText(handle.stderr)).pipe(
        Effect.forkScoped,
      );
      let stoppedEarly = false;
      yield* Stream.splitLines(Stream.decodeText(handle.stdout)).pipe(
        Stream.takeUntil((line) => {
          stoppedEarly = request.onLine(line);
          return stoppedEarly;
        }),
        Stream.runDrain,
      );
      if (stoppedEarly) return { exitCode: undefined, stderr: "", stoppedEarly };
      const exitCode = yield* handle.exitCode;
      const stderr = yield* Fiber.join(stderrFiber);
      return { exitCode, stderr, stoppedEarly };
    }),
  );

const streamCommand = (request: commandTypes.StreamRequest): Promise<commandTypes.StreamOutput> =>
  nodeRuntime.runPromise(
    streamLines(request).pipe(
      Effect.mapError(
        (error) =>
          new ToolFailure({
            cause: error,
            message: `Failed to run ${request.file}: ${error.message}`,
          }),
      ),
    ),
    request.signal === undefined ? undefined : { signal: request.signal },
  );

const command = {
  runCommand,
  streamCommand,
};

export default command;
