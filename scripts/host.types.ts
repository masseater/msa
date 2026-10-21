import type { Effect, Scope, Stream } from "effect";

import type host from "./host.ts";

declare namespace hostTypes {
  interface FileInfo {
    readonly birthtimeMs: number | undefined;
    readonly isDirectory: boolean;
    readonly isFile: boolean;
    readonly mtimeMs: number | undefined;
    readonly size: number;
  }

  type InputMode = "ignore" | "inherit" | "pipe";

  type OutputMode = "ignore" | "inherit" | "pipe";

  interface CommandOptions {
    readonly args: ReadonlyArray<string>;
    readonly command: string;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly extendEnv?: boolean;
    readonly shell?: boolean;
    readonly stderr?: OutputMode;
    readonly stdin?: InputMode;
    readonly stdout?: OutputMode;
  }

  interface CommandResult {
    readonly exitCode: number;
    readonly stderr: string;
    readonly stdout: string;
  }

  interface RunningCommand {
    readonly endInput: Effect.Effect<void>;
    readonly exitCode: Effect.Effect<number>;
    readonly kill: Effect.Effect<void>;
    readonly stderrChunks: Stream.Stream<string>;
    readonly stderrText: Effect.Effect<string>;
    readonly stdoutLines: Stream.Stream<string>;
    readonly stdoutText: Effect.Effect<string>;
    readonly write: (text: string) => Effect.Effect<void>;
  }

  interface HostShape {
    readonly basename: (path: string, suffix?: string) => string;
    readonly chmod: (path: string, mode: number) => Effect.Effect<void>;
    readonly dirname: (path: string) => string;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly extname: (path: string) => string;
    readonly isAbsolute: (path: string) => boolean;
    readonly join: (...paths: ReadonlyArray<string>) => string;
    readonly lines: (path: string) => Stream.Stream<string>;
    readonly makeDirectory: (path: string) => Effect.Effect<void>;
    readonly makeTempDirectory: (prefix: string) => Effect.Effect<string>;
    readonly readDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<ReadonlyArray<string>>;
    readonly readText: (path: string) => Effect.Effect<string>;
    readonly relative: (from: string, to: string) => string;
    readonly remove: (path: string) => Effect.Effect<void>;
    readonly resolve: (...segments: ReadonlyArray<string>) => string;
    readonly run: (options: CommandOptions) => Effect.Effect<CommandResult>;
    readonly sep: string;
    readonly spawn: (options: CommandOptions) => Effect.Effect<RunningCommand, never, Scope.Scope>;
    readonly stat: (path: string) => Effect.Effect<FileInfo>;
    readonly writeText: (path: string, data: string) => Effect.Effect<void>;
  }

  type Host = (typeof host.Host)["prototype"];
}

export type { hostTypes as default };
