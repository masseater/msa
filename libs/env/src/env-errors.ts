import hostKeyChangedError from "./host-key-changed-error.ts";
import hostKeyUnknownError from "./host-key-unknown-error.ts";
import remoteError from "./remote-error.ts";
import sshError from "./ssh-error.ts";

const envErrors = {
  HostKeyChangedError: hostKeyChangedError.HostKeyChangedError,
  HostKeyUnknownError: hostKeyUnknownError.HostKeyUnknownError,
  RemoteError: remoteError.RemoteError,
  SshError: sshError.SshError,
  isConnectionLost: remoteError.isConnectionLost,
};

export default envErrors;
