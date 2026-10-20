import type { Effect, Stream } from "effect";

import type platform from "./platform.ts";

declare namespace platformTypes {
  interface PathOps {
    readonly sep: string;
    readonly basename: (path: string) => string;
    readonly dirname: (path: string) => string;
    readonly join: (...paths: readonly string[]) => string;
    readonly resolve: (...paths: readonly string[]) => string;
    readonly isAbsolute: (path: string) => boolean;
  }

  interface TextWrite {
    readonly path: string;
    readonly text: string;
    readonly mode?: number;
    readonly exclusive?: boolean;
  }

  interface Rename {
    readonly from: string;
    readonly to: string;
  }

  interface Directories {
    readonly path: string;
    readonly mode: number;
  }

  interface ProcessSpec {
    readonly command: string;
    readonly args: readonly string[];
    readonly stdin: Stream.Stream<Uint8Array> | "ignore";
  }

  interface SpawnedProcess {
    readonly stdout: Stream.Stream<Uint8Array>;
    readonly stderr: Stream.Stream<Uint8Array>;
    readonly exitCode: Effect.Effect<number | null>;
  }

  type SpawnError = (typeof platform.SpawnError)["prototype"];
}

export type { platformTypes as default };
