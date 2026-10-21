import Connection from "./connection-class.ts";
import remoteError from "./remote-error.ts";

const connection = {
  Connection,
  RemoteError: remoteError.RemoteError,
  isConnectionLost: remoteError.isConnectionLost,
};

export default connection;
