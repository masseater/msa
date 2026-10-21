import type remoteErrorTypes from "./remote-error.types.ts";

declare namespace frameTypes {
  interface Frame {
    readonly type: number;
    readonly id: number;
    readonly json: remoteErrorTypes.Json;
    readonly payload?: Uint8Array | undefined;
  }
}

export type { frameTypes as default };
