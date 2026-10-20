import type detectTypes from "./detect.types.ts";
import type hostKeyChangedErrorTypes from "./host-key-changed-error.types.ts";
import type hostKeyUnknownErrorTypes from "./host-key-unknown-error.types.ts";
import type remoteInfoTypes from "./remote-info.types.ts";
import type sshArgsTypes from "./ssh-args.types.ts";
import type sshErrorTypes from "./ssh-error.types.ts";

declare namespace sshTypes {
  interface SshConnectOptions extends sshArgsTypes.SshTarget {
    binary?: string;
    loginShell?: boolean;
    onLog?: remoteInfoTypes.ConnectionOptions["onLog"];
  }

  type RemotePlatform = detectTypes.RemotePlatform;

  type SshTarget = sshArgsTypes.SshTarget;

  type HostKeyChangedError = hostKeyChangedErrorTypes.HostKeyChangedError;

  type HostKeyUnknownError = hostKeyUnknownErrorTypes.HostKeyUnknownError;

  type SshError = sshErrorTypes.SshError;
}

export type { sshTypes as default };
