import { Effect } from "effect";
import { dual } from "effect/Function";

import BuildHost from "./build-host-service.ts";
import buildProcess from "./build-process.ts";
import type buildProcessTypes from "./build-process.types.ts";

const { Win32BuildError, installOutput, runInherited } = buildProcess;

interface MingwCompiler {
  readonly command: string;
  readonly useTargetFlag: boolean;
}

const resolveMingwCompiler = (
  target: buildProcessTypes.Win32Target,
): Effect.Effect<MingwCompiler | undefined, never, BuildHost> =>
  Effect.gen(function* () {
    const host = yield* BuildHost;
    const envCompiler = yield* host.env(target.envCompiler);
    if (envCompiler !== undefined) return { command: envCompiler, useTargetFlag: false };
    const cc = yield* host.env("CC");
    if (cc !== undefined) return { command: cc, useTargetFlag: true };
    for (const command of target.prefixedCompilers) {
      if (yield* host.commandExists(command)) return { command, useTargetFlag: false };
    }
    if (yield* host.commandExists("clang")) return { command: "clang", useTargetFlag: true };
    return undefined;
  });

function mingwArgs(
  context: buildProcessTypes.BuildContext,
  options: {
    compiler: MingwCompiler;
    target: buildProcessTypes.Win32Target;
    temporaryOutput: string;
  },
): Array<string> {
  return [
    ...(options.compiler.useTargetFlag ? [`--target=${options.target.mingwTarget}`] : []),
    "-std=c11",
    "-Wall",
    "-Wextra",
    "-Oz",
    "-fno-builtin",
    "-shared",
    "-nostdlib",
    "-Wl,--no-entry",
    "-Wl,--strip-all",
    context.sourceFile,
    "-lkernel32",
    "-luser32",
    "-o",
    options.temporaryOutput,
  ];
}

const buildWithMingw: {
  (
    context: buildProcessTypes.BuildContext,
    target: buildProcessTypes.Win32Target,
  ): Effect.Effect<void, buildProcessTypes.Win32BuildError, BuildHost>;
  (
    target: buildProcessTypes.Win32Target,
  ): (
    context: buildProcessTypes.BuildContext,
  ) => Effect.Effect<void, buildProcessTypes.Win32BuildError, BuildHost>;
} = dual(
  2,
  (
    context: buildProcessTypes.BuildContext,
    target: buildProcessTypes.Win32Target,
  ): Effect.Effect<void, buildProcessTypes.Win32BuildError, BuildHost> =>
    Effect.gen(function* () {
      const compiler = yield* resolveMingwCompiler(target);
      if (compiler === undefined) {
        return yield* new Win32BuildError({
          message: `No Windows cross-compiler found for ${target.arch}. Install Microsoft C++ Build Tools on Windows, or set ${target.envCompiler} to a MinGW-compatible compiler.`,
        });
      }
      const host = yield* BuildHost;
      const buildDir = host.join(context.temporaryDir, `mingw-${target.arch}`);
      const temporaryOutput = host.join(buildDir, "win32-platform.node");
      yield* host.makeDirectory(buildDir);
      yield* runInherited(
        compiler.command,
        mingwArgs(context, { compiler, target, temporaryOutput }),
        buildDir,
      );
      yield* installOutput(context, temporaryOutput, target);
    }),
);

export default buildWithMingw;
