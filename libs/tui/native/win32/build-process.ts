import { Console, Effect, Schema } from "effect";
import { dual } from "effect/Function";

import BuildHost from "./build-host-service.ts";
import type buildProcessTypes from "./build-process.types.ts";

class Win32BuildError extends Schema.TaggedError<
  Win32BuildError,
  { readonly brand: unique symbol }
>()("Win32BuildError", { message: Schema.String }) {}

const runInherited: {
  (
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
  ): Effect.Effect<void, Win32BuildError, BuildHost>;
  (
    args: ReadonlyArray<string>,
    cwd: string,
  ): (command: string) => Effect.Effect<void, Win32BuildError, BuildHost>;
} = dual(
  3,
  (
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
  ): Effect.Effect<void, Win32BuildError, BuildHost> =>
    Effect.gen(function* () {
      const host = yield* BuildHost;
      const exitCode = yield* host.exitCode({ args, command, cwd, stdio: "inherit" });
      if (exitCode !== 0) {
        return yield* Win32BuildError.make({
          message: `${command} failed with exit code ${exitCode}`,
        });
      }
    }),
);

function quoteBatch(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const installOutput: {
  (
    context: buildProcessTypes.BuildContext,
    temporaryOutput: string,
    target: buildProcessTypes.Win32Target,
  ): Effect.Effect<void, Win32BuildError, BuildHost>;
  (
    temporaryOutput: string,
    target: buildProcessTypes.Win32Target,
  ): (context: buildProcessTypes.BuildContext) => Effect.Effect<void, Win32BuildError, BuildHost>;
} = dual(
  3,
  (
    context: buildProcessTypes.BuildContext,
    temporaryOutput: string,
    target: buildProcessTypes.Win32Target,
  ): Effect.Effect<void, Win32BuildError, BuildHost> =>
    Effect.gen(function* () {
      const host = yield* BuildHost;
      const outputDir = host.join(context.scriptDir, "prebuilds", `win32-${target.arch}`);
      yield* host.makeDirectory(outputDir);
      const output = host.join(outputDir, "win32-platform.node");
      yield* host.installExecutable(temporaryOutput, output);
      yield* Console.log(`Built ${host.relative(process.cwd(), output)}`);
    }),
);

const buildProcess = {
  Win32BuildError,
  installOutput,
  quoteBatch,
  runInherited,
};

export default buildProcess;
