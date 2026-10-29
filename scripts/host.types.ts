import type { Effect, Scope, Stream } from "effect";

import type htmlDocumentTypes from "../libs/ai/src/utils/html-document.types.ts";
import type scriptOutputTypes from "../libs/ai/src/utils/script-output.types.ts";
import type host from "./host.ts";

declare namespace hostTypes {
  type FileInfo = scriptOutputTypes.FileInfo;

  type InputMode = scriptOutputTypes.InputMode;

  type OutputMode = scriptOutputTypes.OutputMode;

  type CommandOptions = scriptOutputTypes.CommandOptions;

  type CommandResult = scriptOutputTypes.CommandResult;

  type RunningCommand = scriptOutputTypes.RunningCommand;

  interface HostShape {
    readonly basename: (path: string, suffix?: string) => string;
    readonly chmod: (path: string, mode: number) => Effect.Effect<void>;
    readonly dirname: (path: string) => string;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly extname: (path: string) => string;
    readonly interactive: boolean;
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
    readonly writeHtmlReport: (
      path: string,
      document: htmlDocumentTypes.HtmlDocument,
    ) => Effect.Effect<void>;
    readonly writeTextFile: (path: string, data: string) => Effect.Effect<void>;
  }

  type Host = (typeof host.Host)["prototype"];
}

export type { hostTypes as default };
