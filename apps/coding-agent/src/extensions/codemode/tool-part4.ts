import source from "@msa/codemode/source";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import executeLazy from "./execute.lazy.ts";
import renderer from "./renderer.ts";
import toolPart1 from "./tool-part1.ts";
import toolPart2 from "./tool-part2.ts";
import toolPart3 from "./tool-part3.ts";
import type toolTypes from "./tool.types.ts";

const { CODEMODE_SOURCE_GRAMMAR } = source;
const { awaited, awaiting } = awaitingModule;
const { loadCodemodeExecutor } = executeLazy;
const { codemodeRenderers } = renderer;
const { CODEMODE_TOOL_NAME, codemodeSchema, codemodeToolSystemPromptContribution } = toolPart1;
const { createCodemodeDescription } = toolPart2;
const { getScriptReach, prepareCodemodeLoadout } = toolPart3;

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

const toolPart4 = {
  createCodemodeToolDefinition,
};

export default toolPart4;
