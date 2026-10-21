import { Context, type Effect, type Scope } from "effect";

import type buildHostServiceTypes from "./build-host-service.types.ts";
import type buildProcessTypes from "./build-process.types.ts";

class BuildHost extends Context.Service<
  BuildHost,
  {
    readonly join: (...segments: ReadonlyArray<string>) => string;
    readonly relative: (from: string, to: string) => string;
    readonly env: (name: string) => Effect.Effect<string | undefined>;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly makeDirectory: (
      path: string,
    ) => Effect.Effect<void, buildProcessTypes.Win32BuildError>;
    readonly writeFile: (
      path: string,
      contents: string,
    ) => Effect.Effect<void, buildProcessTypes.Win32BuildError>;
    readonly installExecutable: (
      from: string,
      to: string,
    ) => Effect.Effect<void, buildProcessTypes.Win32BuildError>;
    readonly commandExists: (command: string) => Effect.Effect<boolean>;
    readonly exitCode: (
      run: buildHostServiceTypes.CommandRun,
    ) => Effect.Effect<number, buildProcessTypes.Win32BuildError>;
    readonly makeTemporaryDirectory: (
      prefix: string,
    ) => Effect.Effect<string, buildProcessTypes.Win32BuildError, Scope.Scope>;
    readonly outputLines: (
      command: string,
      args: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<string>, buildProcessTypes.Win32BuildError>;
  }
>()("@msa/tui/native/win32/build-host-service/BuildHost") {}

export default BuildHost;
