import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";

import type typesRegistryTypes from "./types-registry.ts";
import type typesToolsTypes from "./types-tools.ts";
import type viewTypesModule from "./view-types.ts";

declare namespace harnessApiTypes {
  type Agent<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Agent<Tool>;
  type Extension<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Extension<Tool>;
  type PromptInput<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.PromptInput<Tool>;
  type PromptSection<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.PromptSection<Tool>;
  type Registry<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Registry<Tool>;
  type RegistryReader<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.RegistryReader<Tool>;
  type RegistrySnapshot<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.RegistrySnapshot<Tool>;
  type ToolExecutionApi<TDetails extends chordTypes.JsonValue = chordTypes.JsonValue> =
    typesToolsTypes.ToolExecutionApi<TDetails>;
  type ToolExecutionResult<TDetails extends chordTypes.JsonValue = chordTypes.JsonValue> =
    typesToolsTypes.ToolExecutionResult<TDetails>;
  type ToolRegistration<
    TParameters extends aiTypes.TSchema = aiTypes.TSchema,
    TDetails extends chordTypes.JsonValue = chordTypes.JsonValue,
  > = typesToolsTypes.ToolRegistration<TParameters, TDetails>;
  type Wrap<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Wrap<Tool>;
  type ConversationView = viewTypesModule.ConversationView;
}

export type { harnessApiTypes as default };
