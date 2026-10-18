import { Console, Data, Effect } from "effect";
import { dual } from "effect/Function";

import { BuildHost } from "./build-host-service.ts";

export interface Win32Target {
  readonly arch: "x64" | "arm64";
  readonly msvcArch: string;
  readonly mingwTarget: string;
  readonly prefixedCompilers: ReadonlyArray<string>;
  readonly envCompiler: "CC_X64" | "CC_ARM64";
}

export interface BuildContext {
  readonly scriptDir: string;
  readonly sourceFile: string;
  readonly temporaryDir: string;
}

export class Win32BuildError extends Data.TaggedError("Win32BuildError")<{
  readonly message: string;
}> {}

export const runInherited: {
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
      const exitCode = yield* host.exitCode({ command, args, cwd, stdio: "inherit" });
      if (exitCode !== 0) {
        return yield* new Win32BuildError({
          message: `${command} failed with exit code ${exitCode}`,
        });
      }
    }),
);

export function quoteBatch(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export const installOutput: {
  (
    context: BuildContext,
    temporaryOutput: string,
    target: Win32Target,
  ): Effect.Effect<void, Win32BuildError, BuildHost>;
  (
    temporaryOutput: string,
    target: Win32Target,
  ): (context: BuildContext) => Effect.Effect<void, Win32BuildError, BuildHost>;
} = dual(
  3,
  (
    context: BuildContext,
    temporaryOutput: string,
    target: Win32Target,
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
