import source from "@msa/codemode/source";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import executeLazy from "../execute.lazy.ts";
import renderer from "../renderer.ts";
import type toolTypes from "../tool.types.ts";
import toolDescription from "./description.ts";
import toolLoadout from "./loadout.ts";
import toolSchema from "./schema.ts";

const { codemodeRenderers } = renderer;
const { loadCodemodeExecutor } = executeLazy;
const { awaited, awaiting } = awaitingModule;
const { CODEMODE_SOURCE_GRAMMAR } = source;
const { getScriptReach, prepareCodemodeLoadout } = toolLoadout;
const { codemodeToolSystemPromptContribution, CODEMODE_TOOL_NAME, codemodeSchema } = toolSchema;
const { createCodemodeDescription } = toolDescription;

function createCodemodeToolDefinition(
  options: toolTypes.CodemodeToolOptions = {},
): extensionsTypesTypes.ToolDefinition<
  typeof codemodeSchema,
  toolTypes.CodemodeToolDetails | undefined
> {
  return {
    constrainedSampling: { type: "grammar", variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR } },
    description: createCodemodeDescription([], { models: options.models === true }),
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          return yield* awaited(
            (yield* awaited(loadCodemodeExecutor())).executeCodemode(
              toolCallId,
              params,
              signal,
              onUpdate,
              ctx,
              options,
            ),
          );
        }),
      ),
    exposure: "model-only",
    label: CODEMODE_TOOL_NAME,
    name: CODEMODE_TOOL_NAME,
    parameters: codemodeSchema,
    prepareLoadout: (loadout) => prepareCodemodeLoadout(loadout, options),
    promptGuidelines: [...codemodeToolSystemPromptContribution.guidelines],
    promptSnippet: codemodeToolSystemPromptContribution.snippet,
    reachesTools: (input) => getScriptReach(input["code"]),
    ...codemodeRenderers,
  };
}

const toolDefinition = { createCodemodeToolDefinition };

export default toolDefinition;
