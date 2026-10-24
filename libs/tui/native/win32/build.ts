import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Console, Effect, Layer } from "effect";

import BuildHost from "./build-host-service.ts";
import buildHostLayer from "./build-host.ts";
import buildWithMingw from "./build-mingw.ts";
import buildMsvc from "./build-msvc.ts";
import buildProcess from "./build-process.ts";
import type buildProcessTypes from "./build-process.types.ts";

const { buildWithMsvc, canUseMsvc, findVisualStudioDevCmd } = buildMsvc;
const { Win32BuildError } = buildProcess;

const USAGE = `Usage: npm --prefix libs/tui run build:native:win32

Builds win32-x64 and win32-arm64 native prebuilds.

Environment:
  MSA_TUI_WIN32_TOOLCHAIN=msvc|mingw
  CC_X64=/path/to/x86_64-w64-mingw32-gcc
  CC_ARM64=/path/to/aarch64-w64-mingw32-gcc
  CC=/path/to/clang`;

const TARGETS: ReadonlyArray<buildProcessTypes.Win32Target> = [
  {
    arch: "x64",
    envCompiler: "CC_X64",
    mingwTarget: "x86_64-w64-windows-gnu",
    msvcArch: "x64",
    prefixedCompilers: ["x86_64-w64-mingw32-gcc", "x86_64-w64-mingw32-clang"],
  },
  {
    arch: "arm64",
    envCompiler: "CC_ARM64",
    mingwTarget: "aarch64-w64-windows-gnu",
    msvcArch: "arm64",
    prefixedCompilers: ["aarch64-w64-mingw32-gcc", "aarch64-w64-mingw32-clang"],
  },
];

type Toolchain = "msvc" | "mingw";

const isToolchainRequest = (value: string | undefined): value is Toolchain | undefined =>
  value === undefined || value === "msvc" || value === "mingw";

const requestedToolchain = BuildHost.use((host) => host.env("MSA_TUI_WIN32_TOOLCHAIN")).pipe(
  Effect.filterOrFail(isToolchainRequest, () =>
    Win32BuildError.make({
      message: "MSA_TUI_WIN32_TOOLCHAIN must be either 'msvc' or 'mingw'",
    }),
  ),
);

const makeContext = Effect.gen(function* () {
  const host = yield* BuildHost;
  return {
    scriptDir: import.meta.dirname,
    sourceFile: host.join(import.meta.dirname, "src", "win32-platform.c"),
    temporaryDir: yield* host.makeTemporaryDirectory("msa-tui-win32-"),
  } satisfies buildProcessTypes.BuildContext;
});

const build = Effect.gen(function* () {
  const toolchainRequest = yield* requestedToolchain;
  const context = yield* makeContext;
  const vsDevCmd = yield* findVisualStudioDevCmd;
  const hasMsvc = vsDevCmd === undefined ? false : yield* canUseMsvc(context, vsDevCmd);
  const toolchain =
    toolchainRequest ?? (process.platform === "win32" && vsDevCmd !== undefined ? "msvc" : "mingw");
  if (toolchain === "mingw") {
    return yield* Effect.forEach(TARGETS, (target) => buildWithMingw(context, target), {
      discard: true,
    });
  }
  if (vsDevCmd === undefined || !hasMsvc) {
    return yield* Win32BuildError.make({
      message:
        "Microsoft C++ Build Tools not found. Install the Visual Studio C++ workload or set MSA_TUI_WIN32_TOOLCHAIN=mingw.",
    });
  }
  yield* Effect.forEach(TARGETS, (target) => buildWithMsvc(context, target, vsDevCmd), {
    discard: true,
  });
});

const program =
  process.argv.includes("--help") || process.argv.includes("-h")
    ? Console.log(USAGE)
    : Effect.scoped(build);

NodeRuntime.runMain(
  Effect.scoped(
    Effect.flatMap(Layer.build(buildHostLayer), (services) =>
      Effect.provideContext(program, services),
    ),
  ),
);
