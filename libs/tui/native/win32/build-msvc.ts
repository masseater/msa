import { Effect, Option } from "effect";
import { dual } from "effect/Function";

import BuildHost from "./build-host-service.ts";
import buildProcess from "./build-process.ts";
import type buildProcessTypes from "./build-process.types.ts";

const { installOutput, quoteBatch, runInherited } = buildProcess;

const VISUAL_STUDIO_EDITIONS = ["BuildTools", "Community", "Professional", "Enterprise"];

const VSWHERE_ARGS = [
  "-latest",
  "-products",
  "*",
  "-requires",
  "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
  "-property",
  "installationPath",
];

function msvcHostArch(): string {
  return process.arch === "arm64" ? "arm64" : "x64";
}

const vswhereCandidates = (
  programFilesX86: string | undefined,
): Effect.Effect<Array<string>, never, BuildHost> =>
  Effect.gen(function* () {
    if (programFilesX86 === undefined) return [];
    const host = yield* BuildHost;
    const vswhere = host.join(
      programFilesX86,
      "Microsoft Visual Studio",
      "Installer",
      "vswhere.exe",
    );
    if (!(yield* host.exists(vswhere))) return [];
    const lines = yield* host
      .outputLines(vswhere, VSWHERE_ARGS)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    return lines
      .map((line) => line.trim())
      .filter((installationPath) => installationPath !== "")
      .map((installationPath) => host.join(installationPath, "Common7", "Tools", "VsDevCmd.bat"));
  });

const findVisualStudioDevCmd: Effect.Effect<string | undefined, never, BuildHost> = Effect.gen(
  function* () {
    const host = yield* BuildHost;
    const programFilesX86 = yield* host.env("ProgramFiles(x86)");
    const programFiles = yield* host.env("ProgramFiles");
    const candidates = yield* vswhereCandidates(programFilesX86);
    for (const base of [programFiles, programFilesX86]) {
      if (base === undefined) continue;
      for (const edition of VISUAL_STUDIO_EDITIONS) {
        candidates.push(
          host.join(
            base,
            "Microsoft Visual Studio",
            "2022",
            edition,
            "Common7",
            "Tools",
            "VsDevCmd.bat",
          ),
        );
      }
    }
    const found = yield* Effect.findFirst(candidates, (candidate) => host.exists(candidate));
    return Option.getOrUndefined(found);
  },
);

const canUseMsvc: {
  (
    context: buildProcessTypes.BuildContext,
    vsDevCmd: string,
  ): Effect.Effect<boolean, never, BuildHost>;
  (
    vsDevCmd: string,
  ): (context: buildProcessTypes.BuildContext) => Effect.Effect<boolean, never, BuildHost>;
} = dual(
  2,
  (
    context: buildProcessTypes.BuildContext,
    vsDevCmd: string,
  ): Effect.Effect<boolean, never, BuildHost> =>
    Effect.gen(function* () {
      const host = yield* BuildHost;
      const probeDir = host.join(context.temporaryDir, "msvc-probe");
      yield* host.makeDirectory(probeDir);
      const batchFile = host.join(probeDir, "probe.cmd");
      yield* host.writeFile(
        batchFile,
        [
          "@echo off",
          `call ${quoteBatch(vsDevCmd)} -no_logo -arch=x64 -host_arch=${msvcHostArch()} >nul`,
          "if errorlevel 1 exit /b %errorlevel%",
          "where cl.exe >nul 2>nul",
        ].join("\r\n"),
      );
      const exitCode = yield* host.exitCode({
        args: ["/d", "/s", "/c", batchFile],
        command: "cmd.exe",
        cwd: probeDir,
        stdio: "ignore",
      });
      return exitCode === 0;
    }).pipe(Effect.orElseSucceed(() => false)),
);

function msvcBuildScript(
  context: buildProcessTypes.BuildContext,
  options: { vsDevCmd: string; target: buildProcessTypes.Win32Target; temporaryOutput: string },
): string {
  const compile = [
    "cl",
    "/nologo",
    "/TC",
    "/std:c11",
    "/W4",
    "/O1",
    "/GS-",
    "/LD",
    `/Fe:${quoteBatch(options.temporaryOutput)}`,
    quoteBatch(context.sourceFile),
    "/link",
    "/NOENTRY",
    "/NODEFAULTLIB",
    "kernel32.lib",
    "user32.lib",
    "/OPT:REF",
    "/OPT:ICF",
  ].join(" ");
  return [
    "@echo off",
    `call ${quoteBatch(options.vsDevCmd)} -no_logo -arch=${options.target.msvcArch} -host_arch=${msvcHostArch()}`,
    "if errorlevel 1 exit /b %errorlevel%",
    compile,
    "if errorlevel 1 exit /b %errorlevel%",
  ].join("\r\n");
}

const buildWithMsvc: {
  (
    context: buildProcessTypes.BuildContext,
    target: buildProcessTypes.Win32Target,
    vsDevCmd: string,
  ): Effect.Effect<void, buildProcessTypes.Win32BuildError, BuildHost>;
  (
    target: buildProcessTypes.Win32Target,
    vsDevCmd: string,
  ): (
    context: buildProcessTypes.BuildContext,
  ) => Effect.Effect<void, buildProcessTypes.Win32BuildError, BuildHost>;
} = dual(
  3,
  (
    context: buildProcessTypes.BuildContext,
    target: buildProcessTypes.Win32Target,
    vsDevCmd: string,
  ): Effect.Effect<void, buildProcessTypes.Win32BuildError, BuildHost> =>
    Effect.gen(function* () {
      const host = yield* BuildHost;
      const buildDir = host.join(context.temporaryDir, `msvc-${target.arch}`);
      const temporaryOutput = host.join(buildDir, "win32-platform.node");
      yield* host.makeDirectory(buildDir);
      const batchFile = host.join(buildDir, "build.cmd");
      yield* host.writeFile(
        batchFile,
        msvcBuildScript(context, { target, temporaryOutput, vsDevCmd }),
      );
      yield* runInherited("cmd.exe", ["/d", "/s", "/c", batchFile], buildDir);
      yield* installOutput(context, temporaryOutput, target);
    }),
);

const buildMsvc = {
  buildWithMsvc,
  canUseMsvc,
  findVisualStudioDevCmd,
};

export default buildMsvc;
