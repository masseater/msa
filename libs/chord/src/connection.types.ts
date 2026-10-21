import type connectionTypesModule from "./connection-types.types.ts";
import type connection from "./connection.ts";
import type relayTypes from "./relay.types.ts";

declare namespace connectionTypes {
  type AcceptOptions<P = unknown> = connectionTypesModule.AcceptOptions<P>;

  type LinkOptions = connectionTypesModule.LinkOptions;

  type Peer = connectionTypesModule.Peer;

  type RelayRef = relayTypes.RelayRef;

  type Connection = (typeof connection.Connection)["prototype"];
}

export type { connectionTypes as default };
