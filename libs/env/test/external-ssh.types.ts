import type { Connection } from "../src/connection.ts";
import type { RemotePlatform } from "../src/ssh.ts";

declare namespace externalSshTypes {
  type Connected = { connection: Connection; remote: RemotePlatform };
}

export type { externalSshTypes as default };
