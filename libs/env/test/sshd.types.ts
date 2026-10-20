import type sshTypes from "../src/ssh.types.ts";

declare namespace sshdTypes {
  interface SshServer {
    readonly root: string;
    readonly home: string;
    readonly target: sshTypes.SshTarget;
    readonly hostFingerprint: string;
  }

  interface ConnectTo {
    readonly server: SshServer;
    readonly loginShell?: boolean;
  }
}

export type { sshdTypes as default };
