import { createProvider } from "../models.ts";
import { createFauxCore } from "./faux-core.ts";
import type { FauxProviderHandle, RegisterFauxProviderOptions } from "./faux-types.ts";

export { createFauxCore } from "./faux-core.ts";
export {
  type FauxContentBlock,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "./faux-messages.ts";
export type {
  FauxModelDefinition,
  FauxProviderHandle,
  FauxProviderRegistration,
  FauxProviderState,
  FauxResponseFactory,
  FauxResponseStep,
  RegisterFauxProviderOptions,
} from "./faux-types.ts";

export function fauxProvider(options: RegisterFauxProviderOptions = {}): FauxProviderHandle {
  const core = createFauxCore(options);
  const provider = createProvider({
    id: core.provider,
    auth: { apiKey: { name: "Faux", resolve: () => Promise.resolve({ auth: {} }) } },
    models: core.models,
    api: {
      stream: core.stream,
      streamSimple: core.streamSimple,
      fetchDeferred: core.fetchDeferred,
      cancelDeferred: core.cancelDeferred,
    },
  });
  return {
    provider,
    api: core.api,
    models: core.models,
    getModel: core.getModel,
    state: core.state,
    setResponses: core.setResponses,
    appendResponses: core.appendResponses,
    getPendingResponseCount: core.getPendingResponseCount,
  };
}
