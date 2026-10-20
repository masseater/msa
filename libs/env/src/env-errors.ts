import HostKeyChangedError from "./host-key-changed-error.ts";
import HostKeyUnknownError from "./host-key-unknown-error.ts";
import remoteError from "./remote-error.ts";
import SshError from "./ssh-error.ts";

const envErrors = {
  HostKeyChangedError: HostKeyChangedError,
  HostKeyUnknownError: HostKeyUnknownError,
  RemoteError: remoteError.RemoteError,
  SshError: SshError,
  isConnectionLost: remoteError.isConnectionLost,
};

export default envErrors;
