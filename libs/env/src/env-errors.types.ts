import type hostKeyChangedErrorTypes from "./host-key-changed-error.types.ts";
import type hostKeyUnknownErrorTypes from "./host-key-unknown-error.types.ts";
import type remoteErrorTypes from "./remote-error.types.ts";
import type sshErrorTypes from "./ssh-error.types.ts";

declare namespace envErrorsTypes {
  type HostKeyChangedError = hostKeyChangedErrorTypes.HostKeyChangedError;

  type HostKeyUnknownError = hostKeyUnknownErrorTypes.HostKeyUnknownError;

  type RemoteError = remoteErrorTypes.RemoteError;

  type SshError = sshErrorTypes.SshError;
}

export type { envErrorsTypes as default };
