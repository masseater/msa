import type connection from "./connection.ts";
import type remoteErrorTypes from "./remote-error.types.ts";
import type sessionTypes from "./session.types.ts";

declare namespace connectionTypes {
  type Json = remoteErrorTypes.Json;

  type Reply = sessionTypes.Reply;

  type RemoteError = remoteErrorTypes.RemoteError;

  type Connection = (typeof connection.Connection)["prototype"];
}

export type { connectionTypes as default };
