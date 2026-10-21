import modelsModule from "../models.ts";
import fauxCore from "./faux-core.ts";
import fauxMessages from "./faux-messages.ts";
import type fauxTypesModule from "./faux-types.ts";

const { createFauxCore } = fauxCore;
const { createProvider } = modelsModule;

function fauxProvider(
  options: fauxTypesModule.RegisterFauxProviderOptions = {},
): fauxTypesModule.FauxProviderHandle {
  const core = createFauxCore(options);
  const provider = createProvider({
    api: {
      cancelDeferred: core.cancelDeferred,
      fetchDeferred: core.fetchDeferred,
      stream: core.stream,
      streamSimple: core.streamSimple,
    },
    auth: { apiKey: { name: "Faux", resolve: () => Promise.resolve({ auth: {} }) } },
    id: core.provider,
    models: core.models,
  });
  return {
    api: core.api,
    appendResponses: core.appendResponses,
    getModel: core.getModel,
    getPendingResponseCount: core.getPendingResponseCount,
    models: core.models,
    provider,
    setResponses: core.setResponses,
    state: core.state,
  };
}

const faux = {
  createFauxCore: fauxCore.createFauxCore,
  fauxAssistantMessage: fauxMessages.fauxAssistantMessage,
  fauxProvider,
  fauxText: fauxMessages.fauxText,
  fauxThinking: fauxMessages.fauxThinking,
  fauxToolCall: fauxMessages.fauxToolCall,
};

export default faux;
