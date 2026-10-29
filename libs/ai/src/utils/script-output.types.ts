import type { Effect, Scope, Stream } from "effect";

import type htmlDocumentTypes from "./html-document.types.ts";
import type ScriptOutputError from "./script-output-error.ts";
import type scriptOutput from "./script-output.ts";

declare namespace scriptOutputTypes {
  interface AllowedDestinations {
    readonly extensions: ReadonlySet<string>;
    readonly names?: ReadonlySet<string>;
  }

  interface ScriptOutputShape {
    readonly copyFileTo: (from: string, to: string) => Effect.Effect<void>;
    readonly copyTreeTo: (from: string, to: string) => Effect.Effect<void>;
    readonly files: ScriptFileSystemShape;
    readonly interactive: boolean;
    readonly movePath: (from: string, to: string) => Effect.Effect<void>;
    readonly path: ScriptPathShape;
    readonly processes: ScriptProcessShape;
    readonly linkPath: (target: string, link: string) => Effect.Effect<void>;
    readonly writeBinaryFile: (path: string, data: Uint8Array) => Effect.Effect<void>;
    readonly writeHtmlReport: (
      path: string,
      document: htmlDocumentTypes.HtmlDocument,
    ) => Effect.Effect<void>;
    readonly writeTextFile: (path: string, data: string) => Effect.Effect<void>;
  }

  interface FileInfo {
    readonly birthtimeMs: number | undefined;
    readonly isDirectory: boolean;
    readonly isFile: boolean;
    readonly mtimeMs: number | undefined;
    readonly size: number;
  }

  type Read<A> = Effect.Effect<A, ScriptOutputError>;

  interface ScriptFileSystemShape {
    readonly chmod: (path: string, mode: number) => Read<void>;
    readonly exists: (path: string) => Read<boolean>;
    readonly lines: (path: string) => Stream.Stream<string, ScriptOutputError>;
    readonly makeDirectory: (path: string) => Read<void>;
    readonly makeTempDirectory: (prefix: string, directory?: string) => Read<string>;
    readonly makeTempDirectoryScoped: (
      prefix: string,
      directory?: string,
    ) => Effect.Effect<string, ScriptOutputError, Scope.Scope>;
    readonly readBytes: (path: string) => Read<Uint8Array>;
    readonly readDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Read<ReadonlyArray<string>>;
    readonly readText: (path: string) => Read<string>;
    readonly remove: (path: string) => Read<void>;
    readonly sha256Hex: (path: string) => Read<string>;
    readonly stat: (path: string) => Read<FileInfo>;
  }

  interface ScriptPathShape {
    readonly basename: (path: string, suffix?: string) => string;
    readonly dirname: (path: string) => string;
    readonly extname: (path: string) => string;
    readonly isAbsolute: (path: string) => boolean;
    readonly join: (...paths: ReadonlyArray<string>) => string;
    readonly relative: (from: string, to: string) => string;
    readonly resolve: (...segments: ReadonlyArray<string>) => string;
    readonly sep: string;
  }

  type InputMode = "ignore" | "inherit" | "pipe";

  type OutputMode = "ignore" | "inherit" | "pipe";

  type CommandName = "bun" | "msa" | "node" | "npm" | "pnpm" | "sudo" | "tar" | "vp" | "zip";

  interface MsaBinary {
    readonly msaBinary: string;
  }

  type ScriptCommand = CommandName | MsaBinary;

  interface CommandRule {
    readonly windowsShell: boolean;
  }

  interface CommandOptions {
    readonly args: ReadonlyArray<string>;
    readonly command: ScriptCommand;
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
    readonly extendEnv?: boolean;
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

  interface ScriptProcessShape {
    readonly run: (options: CommandOptions) => Effect.Effect<CommandResult>;
    readonly spawn: (options: CommandOptions) => Effect.Effect<RunningCommand, never, Scope.Scope>;
  }

  type ScriptOutput = (typeof scriptOutput.ScriptOutput)["prototype"];
}

export type { scriptOutputTypes as default };
