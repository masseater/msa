import type remoteRef from "./remote-ref.ts";
import type remoteTypes from "./remote.types.ts";

declare namespace remoteRefTypes {
  type RemoteBinding = remoteTypes.RemoteBinding;

  type RemoteRef = (typeof remoteRef.RemoteRef)["prototype"];
}

export type { remoteRefTypes as default };
