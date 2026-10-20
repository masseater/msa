import Connection from "./connection-class.ts";
import connectionKit from "./connection-kit.ts";

const connection = {
  Connection,
  RelayRef: connectionKit.relayModule,
};

export default connection;
