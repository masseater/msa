import type { SshTarget } from "../src/ssh.ts";

declare namespace sshdTypes {
  interface SshServer {
    readonly root: string;
    readonly home: string;
    readonly target: SshTarget;
    readonly hostFingerprint: string;
  }

  interface ConnectTo {
    readonly server: SshServer;
    readonly loginShell?: boolean;
  }
}

export type { sshdTypes as default };
