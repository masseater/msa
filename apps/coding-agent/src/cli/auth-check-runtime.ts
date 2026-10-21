import type aiTypes from "@msa/ai/index.types";

import InMemoryCodingAgentModelsStore from "../core/in-memory-coding-agent-models-store.ts";
import ModelRuntime from "../core/model-runtime.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";

const createAuthCheckModelRuntime = (
  credentials: aiTypes.CredentialStore,
): Promise<modelRuntimeTypes.ModelRuntime> =>
  ModelRuntime.create({
    allowModelNetwork: false,
    credentials,
    modelsStore: new InMemoryCodingAgentModelsStore(),
    refreshOnCreate: false,
  });

const authCheckRuntime = { createAuthCheckModelRuntime };

export default authCheckRuntime;
