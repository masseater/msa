import srcConfig from "../../../config.ts";
import platformNode from "../../../core/platform-node.ts";
import type oauthTypesNs from "../oauth.types.ts";
import type McpRuntime from "../runtime.ts";
import type runtimeTypes from "../runtime.types.ts";
import type McpExtensionHost from "./host.ts";

const { join } = platformNode;
const { getAgentDir } = srcConfig;

export default class McpRuntimeResources {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly getCredentials = (runtime: typeof McpRuntime): oauthTypesNs.McpOAuthCredentialStore => {
    const credentials = (this.host.credentials ??= new runtime.McpOAuthCredentialStore());
    return credentials;
  };

  readonly getServerLog = (runtime: typeof McpRuntime): runtimeTypes.McpServerLog => {
    const log = (this.host.serverLog ??= new runtime.McpServerLog(
      this.host.options.logPath ?? join(getAgentDir(), "mcp.log"),
    ));
    return log;
  };
}
