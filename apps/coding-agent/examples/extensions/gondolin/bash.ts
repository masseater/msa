import type { VM } from "@earendil-works/gondolin";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Duration, Effect, Schema, Stream } from "effect";

import paths from "./paths.ts";

const { toGuestPath } = paths;

type ExecOptions = Parameters<codingAgentTypes.BashOperations["exec"]>[2];

interface ExecRequest {
  readonly vm: VM;
  readonly shellPath: string;
  readonly command: string;
  readonly guestCwd: string;
}

class GondolinExecFailure extends Schema.TaggedError<
  GondolinExecFailure,
  { readonly brand: unique symbol }
>()("GondolinExecFailure", { cause: Schema.optionalKey(Schema.Unknown), message: Schema.String }) {}

const execFailure = (cause: unknown) =>
  GondolinExecFailure.make({
    cause,
    message: cause instanceof Error ? cause.message : String(cause),
  });

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

const runCommand = (request: ExecRequest, options: ExecOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const signal = yield* Effect.abortSignal;
      const proc = request.vm.exec([request.shellPath, "-lc", request.command], {
        cwd: request.guestCwd,
        ...(options.env === undefined ? {} : { env: sanitizeEnv(options.env) }),
        signal,
        stderr: "pipe",
        stdout: "pipe",
      });
      yield* Stream.runForEach(Stream.fromAsyncIterable(proc.output(), execFailure), (chunk) =>
        Effect.sync(() => options.onData(chunk.data)),
      );
      const result = yield* Effect.tryPromise({ catch: execFailure, try: () => proc });
      return { exitCode: result.exitCode };
    }),
  );

const failOnAbort = (signal: AbortSignal) =>
  Effect.callback<never, GondolinExecFailure>((resume) => {
    const onAbort = () => resume(Effect.fail(GondolinExecFailure.make({ message: "aborted" })));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const execInVm = (request: ExecRequest, options: ExecOptions) =>
  Effect.gen(function* () {
    const { signal, timeout } = options;
    if (signal?.aborted === true) return yield* GondolinExecFailure.make({ message: "aborted" });
    const timed =
      timeout !== undefined && timeout > 0
        ? runCommand(request, options).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(timeout),
              orElse: () =>
                Effect.fail(GondolinExecFailure.make({ message: `timeout:${timeout}` })),
            }),
          )
        : runCommand(request, options);
    return yield* signal === undefined ? timed : Effect.raceFirst(timed, failOnAbort(signal));
  });

function createGondolinBashOps(
  vm: VM,
  localCwd: string,
  shellPath: string,
): codingAgentTypes.BashOperations {
  return {
    exec: (command, cwd, options) =>
      Effect.runPromise(
        execInVm({ command, guestCwd: toGuestPath(localCwd, cwd), shellPath, vm }, options),
      ),
  };
}

const bash = { createGondolinBashOps };

export default bash;
