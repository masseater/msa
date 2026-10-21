import type connectionTypes from "../src/connection.types.ts";
import type sshTypes from "../src/ssh.types.ts";

declare namespace externalSshTypes {
  type Connected = { connection: connectionTypes.Connection; remote: sshTypes.RemotePlatform };
}

export type { externalSshTypes as default };
