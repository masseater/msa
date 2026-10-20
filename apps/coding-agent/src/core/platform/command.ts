import { Effect, Fiber, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { platformRuntime } from "./index.ts";
import { ToolFailure } from "./tool-failure.ts";

export interface CommandRequest {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export interface CommandOutput {
  readonly lines: ReadonlyArray<string>;
  readonly stderr: string;
  readonly exitCode: number;
}

const collect = (request: CommandRequest) =>
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

export const runCommand = (request: CommandRequest): Promise<CommandOutput> =>
  platformRuntime.runPromise(
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

export interface StreamRequest extends CommandRequest {
  readonly onLine: (line: string) => boolean;
}

export interface StreamOutput {
  readonly stoppedEarly: boolean;
  readonly stderr: string;
  readonly exitCode: number | undefined;
}

const streamLines = (request: StreamRequest) =>
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

export const streamCommand = (request: StreamRequest): Promise<StreamOutput> =>
  platformRuntime.runPromise(
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
