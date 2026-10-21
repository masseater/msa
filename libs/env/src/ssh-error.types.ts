import type SshErrorClass from "./ssh-error.ts";

declare namespace sshErrorTypes {
  type SshError = SshErrorClass;
}

export type { sshErrorTypes as default };
