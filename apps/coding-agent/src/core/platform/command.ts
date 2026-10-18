import { Effect, Stream } from "effect";
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
      return { lines, stderr, exitCode };
    }),
  );

export const runCommand = (request: CommandRequest): Promise<CommandOutput> =>
  platformRuntime.runPromise(
    collect(request).pipe(
      Effect.mapError(
        (error) =>
          new ToolFailure({
            message: `Failed to run ${request.file}: ${error.message}`,
            cause: error,
          }),
      ),
    ),
    request.signal === undefined ? undefined : { signal: request.signal },
  );
