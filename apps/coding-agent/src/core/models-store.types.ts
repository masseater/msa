import type FileModelsStoreClass from "./file-models-store.ts";
import type InMemoryCodingAgentModelsStoreClass from "./in-memory-coding-agent-models-store.ts";

declare namespace modelsStoreTypes {
  type InMemoryCodingAgentModelsStore = (typeof InMemoryCodingAgentModelsStoreClass)["prototype"];

  type FileModelsStore = (typeof FileModelsStoreClass)["prototype"];
}

export type { modelsStoreTypes as default };
