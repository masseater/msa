import type remoteError from "./remote-error.ts";

declare namespace remoteErrorTypes {
  type Json = Record<string, unknown>;

  type Wire<T> = { [K in keyof T]: T[K] };

  type RemoteError = (typeof remoteError.RemoteError)["prototype"];
}

export type { remoteErrorTypes as default };
