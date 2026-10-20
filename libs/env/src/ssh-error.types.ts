import type sshError from "./ssh-error.ts";

declare namespace sshErrorTypes {
  type SshError = (typeof sshError.SshError)["prototype"];
}

export type { sshErrorTypes as default };
