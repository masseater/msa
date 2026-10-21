import type connectionTypes from "./connection.types.ts";

declare namespace writeFileTypes {
  interface FileWrite {
    readonly connection: connectionTypes.Connection;
    readonly resolved: string;
    readonly bytes: Uint8Array;
    readonly append: boolean;
    readonly signal: AbortSignal | undefined;
  }
}

export type { writeFileTypes as default };
