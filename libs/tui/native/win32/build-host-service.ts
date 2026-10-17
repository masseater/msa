import { Context, type Effect, type Scope } from "effect";

import type { Win32BuildError } from "./build-process.ts";

export interface CommandRun {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly stdio: "inherit" | "ignore";
}

export class BuildHost extends Context.Service<
  BuildHost,
  {
    readonly join: (...segments: ReadonlyArray<string>) => string;
    readonly relative: (from: string, to: string) => string;
    readonly env: (name: string) => Effect.Effect<string | undefined>;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly makeDirectory: (path: string) => Effect.Effect<void, Win32BuildError>;
    readonly writeFile: (path: string, contents: string) => Effect.Effect<void, Win32BuildError>;
    readonly installExecutable: (from: string, to: string) => Effect.Effect<void, Win32BuildError>;
    readonly commandExists: (command: string) => Effect.Effect<boolean>;
    readonly exitCode: (run: CommandRun) => Effect.Effect<number, Win32BuildError>;
    readonly makeTemporaryDirectory: (
      prefix: string,
    ) => Effect.Effect<string, Win32BuildError, Scope.Scope>;
    readonly outputLines: (
      command: string,
      args: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<string>, Win32BuildError>;
  }
>()("@msa/tui/native/win32/build-host-service/BuildHost") {}
