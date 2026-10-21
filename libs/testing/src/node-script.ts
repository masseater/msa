import { Clock, Effect, Stream } from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

import type nodeScriptTypes from "./node-script.types.ts";
import runtime from "./runtime.ts";

const { provideNode } = runtime;

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const runModule = (
  source: string,
  options: nodeScriptTypes.Options,
): Effect.Effect<nodeScriptTypes.Result> =>
  Effect.scoped(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const handle = yield* ChildProcess.make(
        process.execPath,
        [
          ...(options.nodeArgs ?? []),
          "--input-type=module",
          "--eval",
          source,
          ...(options.scriptArgs ?? []),
        ],
        {
          cwd: options.cwd,
          env: options.env,
          extendEnv: true,
          stderr: "pipe",
          stdin: "ignore",
          stdout: "pipe",
        },
      );
      const { code, stderr, stdout } = yield* Effect.all(
        { code: handle.exitCode, stderr: text(handle.stderr), stdout: text(handle.stdout) },
        { concurrency: "unbounded" },
      );
      const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
      return { code: Number(code), elapsedMs, stderr, stdout };
    }),
  ).pipe(Effect.timeout(options.timeout ?? "30 seconds"), Effect.orDie, provideNode);

const runNodeScript: {
  (options: nodeScriptTypes.Options): (source: string) => Effect.Effect<nodeScriptTypes.Result>;
  (source: string, options: nodeScriptTypes.Options): Effect.Effect<nodeScriptTypes.Result>;
} = dual(2, runModule);

const nodeScript = {
  runNodeScript,
};

export default nodeScript;
