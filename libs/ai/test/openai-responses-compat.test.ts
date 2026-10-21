import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import modelChoice from "./model-choice.ts";
import openaiResponsesCompatSupport from "./openai-responses-compat-support.ts";

const { chooseModel, compatValue, modelsWhere, usesApi } = modelChoice;
const { captureResponsesRequest } = openaiResponsesCompatSupport;

const reasoningResponsesModels = (off: string | null) =>
  modelsWhere(
    "openai",
    (model) =>
      usesApi("openai-responses")(model) && model.reasoning && model.thinkingLevelMap?.off === off,
  );

const forwardsRequiredToolChoice = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureResponsesRequest(
        { toolChoice: "required" } as Record<string, unknown>,
        {
          content: "Do not call ping. Respond with text instead.",
          tools: [
            {
              description: "Ping",
              name: "ping",
              parameters: Type.Object({ value: Type.String() }),
            },
          ],
        },
      );
      expect(payload).toMatchObject({
        tool_choice: "required",
        tools: [expect.objectContaining({ name: "ping" })],
      });
    }),
  );

const strictModeTools = [
  {
    description: "An ordinary tool",
    name: "ordinary",
    parameters: Type.Object({ offset: Type.Optional(Type.Number()), path: Type.String() }),
  },
  {
    constrainedSampling: { strict: "prefer" as const, type: "json_schema" as const },
    description: "A constrained tool",
    name: "constrained",
    parameters: Type.Object({ value: Type.String() }),
  },
];

const setsStrictModeExplicitly = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel(
        "openai",
        "strict-capable Responses",
        (candidate): candidate is typesModule.Model<"openai-responses"> =>
          usesApi("openai-responses")(candidate) &&
          compatValue(candidate, "supportsStrictMode") === true,
      );
      const { payload } = yield* captureResponsesRequest(
        {},
        { content: "Use a tool.", model, tools: strictModeTools },
      );
      expect(payload?.tools).toEqual([
        expect.objectContaining({ name: "ordinary", strict: false }),
        expect.objectContaining({ name: "constrained", strict: true }),
      ]);
    }),
  );

const sendsNoneEffort = (model: typesModule.Model<"openai-responses">) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureResponsesRequest({}, { model });
      expect(payload).toMatchObject({ reasoning: { effort: "none" } });
    }),
  );

const omitsEffort = (model: typesModule.Model<"openai-responses">) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureResponsesRequest({}, { model });
      expect(payload).toBeDefined();
      expect(payload).not.toHaveProperty("reasoning");
    }),
  );

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards required tool choice", forwardsRequiredToolChoice);
  it("sets strict mode explicitly for OpenAI Responses tools", setsStrictModeExplicitly);
  it.for(reasoningResponsesModels("none"))(
    "sends none reasoning effort for OpenAI $id when no reasoning is requested",
    sendsNoneEffort,
  );
  it.for(reasoningResponsesModels(null))(
    "omits reasoning effort for OpenAI $id when off is unsupported",
    omitsEffort,
  );
});
