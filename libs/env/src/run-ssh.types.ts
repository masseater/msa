import type hostKeyChangedErrorTypes from "./host-key-changed-error.types.ts";
import type hostKeyUnknownErrorTypes from "./host-key-unknown-error.types.ts";
import type sshArgsTypes from "./ssh-args.types.ts";
import type sshErrorTypes from "./ssh-error.types.ts";

declare namespace runSshTypes {
  type SshFailure =
    | sshErrorTypes.SshError
    | hostKeyChangedErrorTypes.HostKeyChangedError
    | hostKeyUnknownErrorTypes.HostKeyUnknownError;

  interface SshRun {
    readonly target: sshArgsTypes.SshTarget;
    readonly command: string;
    readonly stdin?: Uint8Array;
    readonly args?: string[];
    readonly timeoutMs?: number;
  }
}

export type { runSshTypes as default };
