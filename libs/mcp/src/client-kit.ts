import McpClientCore from "./client-core.ts";
import clientResults from "./client-results.ts";
import foreign from "./foreign.ts";
import McpClientError from "./protocol/errors/client-error.ts";

const clientKit = {
  McpClientCore,
  McpClientError,
  clientResults,
  foreign,
};

export default clientKit;
