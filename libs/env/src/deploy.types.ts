import type detectTypes from "./detect.types.ts";
import type sshArgsTypes from "./ssh-args.types.ts";

declare namespace deployTypes {
  interface DaemonDeployment {
    readonly target: sshArgsTypes.SshTarget;
    readonly remote: detectTypes.RemotePlatform;
    readonly binary: string;
  }
}

export type { deployTypes as default };
