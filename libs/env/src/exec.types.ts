import type chordTypes from "@msa/chord/index.types";
import type envTypes from "@msa/durable/env.types";

import type fileOpTypes from "./file-op.types.ts";

declare namespace execTypes {
  interface ExecIn {
    readonly target: fileOpTypes.RemoteTarget;
    readonly command: string | readonly string[];
    readonly options: envTypes.ShellExecOptions | undefined;
    readonly context: chordTypes.Context;
    readonly shellEnv: Record<string, string> | undefined;
    readonly shellPath: string | undefined;
    readonly running: Map<number, number>;
  }
}

export type { execTypes as default };
