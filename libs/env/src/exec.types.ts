import type { Context } from "@msa/chord";
import type { ShellExecOptions } from "@msa/durable/env";

import type fileOpTypes from "./file-op.types.ts";

declare namespace execTypes {
  interface ExecIn {
    readonly target: fileOpTypes.RemoteTarget;
    readonly command: string | readonly string[];
    readonly options: ShellExecOptions | undefined;
    readonly context: Context;
    readonly shellEnv: Record<string, string> | undefined;
    readonly shellPath: string | undefined;
    readonly running: Map<number, number>;
  }
}

export type { execTypes as default };
