import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { CodemodeToolDetails } from "../../src/extensions/codemode/tool.ts";
import agentSessionCodemodeModels from "./agent-session-codemode-models.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";

const { resultText, runCodemode, trackCodemodeWorkers } = agentSessionCodemodeSupport;

const { QUESTIONS, cleanupModelHarnesses, setup4 } = agentSessionCodemodeModels;

const { awaited, fromJsonText, runTest } = testing;

trackCodemodeWorkers();

const ERRORS_SCRIPT = `
			const model = await models.getModelOfType("classifier", "scorer", "judge");
			const failed = await models.classify(model, { state: { text: "explode" }, questions: ${QUESTIONS} });
			const textOnly = await models.classify(model, {
				state: { text: "good" },
				images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
				questions: ${QUESTIONS},
			});
			const attempt = async (fn) => { try { await fn(); return "ok"; } catch (error) { return error.message; } };
			return {
				failed: [failed.stopReason, failed.errorMessage],
				textOnly: [textOnly.stopReason, textOnly.errorMessage],
				badClassifierImage: await attempt(() =>
					models.classify(model, { state: {}, images: [{ data: "aW1hZ2U=" }], questions: ${QUESTIONS} }),
				),
				badType: await attempt(() => models.getModelsOfType("video")),
				unknown: await attempt(() => models.classify({ provider: "scorer", id: "nope" }, {})),
				noModel: await attempt(() => models.classify("judge", {})),
				undefinedModel: await attempt(() => models.classify(undefined, {})),
				noState: await attempt(() => models.classify(model, { questions: ${QUESTIONS} })),
				badQuestion: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "choice", instructions: "Kind?", criteria: ["a", "b"] } } }),
				),
				badImage: await attempt(() => models.generateImages({ provider: "scorer", id: "painter" }, { prompt: "a fox" })),
				arrayModel: await attempt(() => models.classify(["scorer", "judge"], {})),
				arrayContext: await attempt(() => models.classify(model, [])),
				arrayState: await attempt(() => models.classify(model, { state: [], questions: ${QUESTIONS} })),
				arrayQuestions: await attempt(() => models.classify(model, { state: {}, questions: [] })),
				arrayQuestion: await attempt(() => models.classify(model, { state: {}, questions: { kind: [] } })),
				noInstructions: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "bool", criteria: { true: "y", false: "n" } } } }),
				),
				badBool: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "bool", instructions: "Ok?", criteria: ["y", "n"] } } }),
				),
				badKind: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "rank", instructions: "Rank?" } } }),
				),
				arrayImagesContext: await attempt(() => models.generateImages({ provider: "scorer", id: "painter" }, [])),
				badImageBlock: await attempt(() =>
					models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }, { type: "image", data: "aW1hZ2U=" }] }),
				),
				badSplit: await attempt(() => models.getModelOfType("classifier", "scorer/judge")),
			};
`;

const EXPECTED_MESSAGES: Record<string, string> = {
  arrayContext:
    "models.classify() expects a context object as its second argument, got an empty array.",
  arrayImagesContext:
    "models.generateImages() expects a context object as its second argument, got an empty array.",
  arrayModel: "models.classify() expects a classifier model as its first argument, got an array.",
  arrayQuestion:
    "models.classify() context.questions.kind must be a question object, got an empty array.",
  arrayQuestions:
    "models.classify() context.questions must map question IDs to questions, got an empty array.",
  arrayState: "models.classify() context.state must be an object, got an empty array.",
  badBool:
    'context.questions.kind is a "bool" question, so criteria must be { true: string, false: string }.',
  badClassifierImage: "models.classify() context.images[0] must be an image block, got { data }.",
  badImage:
    "models.generateImages() context.input must be a non-empty array of blocks, got undefined.",
  badImageBlock:
    "models.generateImages() context.input[1] must be a text or image block, got { type, data }.",
  badKind: 'context.questions.kind.type must be "choice", "score", or "bool", got "rank".',
  badQuestion:
    'context.questions.kind is a "choice" question, so criteria must map each label to its meaning.',
  badSplit: "The provider and the id are separate arguments",
  badType: 'Unknown model type "video"',
  noInstructions: "models.classify() context.questions.kind.instructions must be a string.",
  noModel: "models.classify() expects a classifier model as its first argument, got a string.",
  noState: "models.classify() context.state must be an object, got undefined.",
  undefinedModel: "models.getModelOfType() returns undefined for an unknown provider or id.",
};

const reportsProviderErrorsAsResultsAnd = Effect.gen(function* () {
  const { harness } = yield* awaited(setup4());
  const result = yield* awaited(runCodemode(harness, ERRORS_SCRIPT));
  expect(result.isError).toBe(false);
  const value = (yield* fromJsonText(resultText(result))) as unknown as Record<string, string[]>;
  expect(value["failed"]).toEqual(["error", "classifier exploded"]);
  expect(value["textOnly"]).toEqual(["error", "Model scorer/judge does not accept image input"]);
  expect(value["unknown"]).toBe(
    'Unknown classifier model "scorer/nope". List the classifier models you can use with models.getAvailableOfType("classifier").',
  );
  expect(value["noState"]).toContain("codemode.md");
  for (const [key, message] of Object.entries(EXPECTED_MESSAGES)) {
    expect(value[key]).toContain(message);
  }
  const details = result.details as unknown as CodemodeToolDetails;
  expect(details.calls.map((call) => [call.name, call.status, call.error])).toEqual([
    ["models.classify", "error", "classifier exploded"],
    ["models.classify", "error", "Model scorer/judge does not accept image input"],
  ]);
  expect(result.usage).toBeUndefined();
});

describe("codemode models", () => {
  afterEach(cleanupModelHarnesses);
  it("reports provider errors as results and invalid arguments as exceptions", () =>
    runTest(reportsProviderErrorsAsResultsAnd));
});
