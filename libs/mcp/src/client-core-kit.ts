import foreign from "./foreign.ts";
import IncomingRequests from "./incoming-requests.ts";
import PendingRequests from "./pending-requests.ts";
import jsonrpc from "./protocol/jsonrpc.ts";

const clientCoreKit = {
  IncomingRequests,
  PendingRequests,
  foreign,
  jsonrpc,
};

export default clientCoreKit;
