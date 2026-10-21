import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type clientTypes from "./client.types.ts";
import type providerTypes from "./provider.types.ts";
import type uiTypes from "./ui.types.ts";

declare namespace llamaSessionTypes {
  interface LlamaSession {
    ctx: extensionsTypesTypes.ExtensionCommandContext;
    ui: uiTypes.LlamaUi;
    client: clientTypes.LlamaClient;
    provider: providerTypes.LlamaProviderController;
  }

  type ModelInfo = clientTypes.LlamaModelInfo;

  type ManagerAction = uiTypes.LlamaManagerAction;
}

export type { llamaSessionTypes as default };
