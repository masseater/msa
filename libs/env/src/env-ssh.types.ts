import type sshArgsTypes from "./ssh-args.types.ts";
import type sshTypes from "./ssh.types.ts";

declare namespace envSshTypes {
  type SshConnectOptions = sshTypes.SshConnectOptions;

  type SshTarget = sshArgsTypes.SshTarget;
}

export type { envSshTypes as default };
