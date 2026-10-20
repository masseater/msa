import type connectionTypes from "./connection.types.ts";
import type handleTypes from "./handle.types.ts";

declare namespace readFileTypes {
  interface FileRead {
    readonly handle: handleTypes.Handle;
    readonly opened: connectionTypes.Json;
    readonly encoding: boolean;
    readonly signal: AbortSignal | undefined;
  }
}

export type { readFileTypes as default };
