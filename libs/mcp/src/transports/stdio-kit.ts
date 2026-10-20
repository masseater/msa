import foreign from "../foreign.ts";
import jsonrpc from "../protocol/jsonrpc.ts";
import McpTransportError from "./errors/transport-error.ts";

const stdioKit = {
  McpTransportError,
  foreign,
  jsonrpc,
};

export default stdioKit;
