import * as NodeServices from "@effect/platform-node/NodeServices";
import { Duration, Effect, ManagedRuntime, Stream } from "effect";
import { ChildProcess } from "effect/process";

const runtime = ManagedRuntime.make(NodeServices.layer);

interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const runNode = (
  args: readonly string[],
  options: { readonly cwd: string; readonly timeout: Duration.Input },
): Promise<ProcessResult> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(process.execPath, [...args], {
          cwd: options.cwd,
          stderr: "pipe",
          stdin: "ignore",
          stdout: "pipe",
        });
        return yield* Effect.all(
          { exitCode: handle.exitCode, stderr: text(handle.stderr), stdout: text(handle.stdout) },
          { concurrency: "unbounded" },
        );
      }),
    ).pipe(Effect.timeout(options.timeout)),
  );

const nodeProcess = { runNode };

export default nodeProcess;
