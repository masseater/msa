import awaitingModule from "../../core/awaiting.ts";
import type typesContextTypes from "../../core/extensions/types-context.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type extensionInternalTypes from "./extension-internal.types.ts";
import extensionPart1 from "./extension-part1.ts";

const { awaited } = awaitingModule;
const { describeState } = extensionPart1;

function* handlerPart1(
  reconnect: (server: extensionInternalTypes.McpServer) => Promise<string | undefined>,
  server: extensionInternalTypes.McpServer,
  ctx: typesContextTypes.ExtensionCommandContext,
  ensureDiscoveryActive: (ctx: extensionsTypesTypes.ExtensionContext) => void,
) {
  const failure = yield* awaited(reconnect(server));
  if (failure !== undefined && failure !== "") ctx.ui.notify(failure, "error");
  else {
    ensureDiscoveryActive(ctx);
    ctx.ui.notify(
      `Reconnected to MCP server "${server.entry.name}" (${describeState(server)}).`,
      "info",
    );
  }
}

const extensionPart2Part1 = {
  handlerPart1,
};

export default extensionPart2Part1;
