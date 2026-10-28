import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime, Stream } from "effect";
import { ChildProcess } from "effect/process";

const runtime = ManagedRuntime.make(NodeServices.layer);

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

type Result = { readonly code: number; readonly stderr: string; readonly stdout: string };

const runNode = (args: readonly string[], cwd: string): Promise<Result> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(process.execPath, args, {
          cwd,
          extendEnv: true,
          stderr: "pipe",
          stdin: "ignore",
          stdout: "pipe",
        });
        const { code, stderr, stdout } = yield* Effect.all(
          { code: handle.exitCode, stderr: text(handle.stderr), stdout: text(handle.stdout) },
          { concurrency: "unbounded" },
        );
        return { code: Number(code), stderr, stdout };
      }),
    ).pipe(Effect.timeout("120 seconds"), Effect.orDie),
  );

const classSealProcess = { runNode };

export default classSealProcess;
