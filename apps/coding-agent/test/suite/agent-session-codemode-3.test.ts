import type agentTypes from "@msa/agent-core/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CODEMODE_DOCS_PATH,
  type CodemodeToolDetails,
  createCodemodeTool,
} from "../../src/extensions/codemode/tool.ts";
import agentSessionCodemodeModels from "./agent-session-codemode-models.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import harnessModule from "./harness.ts";

const { TINY_PNG_BASE64, checkSavedImages, resultText, runCodemode, trackCodemodeWorkers } =
  agentSessionCodemodeSupport;

const { QUESTIONS, cleanupModelHarnesses, harnesses4, setup4 } = agentSessionCodemodeModels;

const { createHarness } = harnessModule;

const { awaited, fromJsonText, runTest } = testing;

trackCodemodeWorkers();

const CLASSIFY_SCRIPT = `
			const [model] = await models.getAvailableOfType("classifier", "scorer");
			const listed = await models.getModelsOfType("classifier");
			const same = await models.getModelOfType("classifier", "scorer", "judge");
			const texts = ["good", "bad", "good", "bad", "good", "bad"];
			const results = await Promise.all(
				texts.map((text) => models.classify({ ...model, baseUrl: "https://evil.test" }, { state: { text }, questions: ${QUESTIONS} })),
			);
			return {
				id: model.id,
				headers: "headers" in model,
				listed: listed.some((entry) => entry.provider === "scorer" && entry.id === "judge"),
				same: same.id,
				missing: (await models.getModelOfType("classifier", "scorer", "nope")) === undefined,
				probabilities: results.map((r) => r.answers.approved.probability),
				cost: results[0].usage.cost.total,
			};
`;

const IMAGES_SCRIPT = `
			const [model] = await models.getAvailableOfType("image", "scorer");
			const reference = { type: "image", data: "${TINY_PNG_BASE64}", mimeType: "image/png" };
			const generated = await models.generateImages(
				{ ...model, baseUrl: "https://evil.test" },
				{ input: [{ type: "text", text: "a fox" }, reference] },
			);
			for (const block of generated.output) {
				if (block.type === "image") image(block);
				else text(block.text);
			}
			const failed = await models.generateImages(model, { input: [{ type: "text", text: "explode" }] });
			const attempt = async (fn) => { try { await fn(); return "ok"; } catch (error) { return error.message; } };
			return {
				id: model.id,
				stopReason: generated.stopReason,
				failed: [failed.stopReason, failed.errorMessage],
				wrongType: await attempt(() => models.generateImages({ provider: "scorer", id: "judge" }, { input: [] })),
			};
`;

const NOTES_SCRIPT = `
			const [model] = await models.getAvailableOfType("image", "scorer");
			const generated = await models.generateImages(model, { input: [{ type: "text", text: "a fox" }] });
			return generated.stopReason;
`;

const declaresModelsOnlyForTheSession = Effect.gen(function* () {
  const { harness } = yield* awaited(setup4());
  const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(codemode?.description).toContain("`models`: classifiers and image generation");
  expect(codemode?.description).toContain(CODEMODE_DOCS_PATH);
  const overridden = yield* awaited(
    createHarness({ tools: [createCodemodeTool() as agentTypes.AgentTool] }),
  );
  harnesses4.push(overridden);
  const plain = overridden.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(plain?.description).not.toContain("`models`");
});

const classifyWithCatalogAuth = Effect.fn("classifyWithCatalogAuth")(function* () {
  const { harness, observed, maxActive, holdUntilInFlight } = yield* awaited(setup4());
  holdUntilInFlight(4);
  const result = yield* awaited(runCodemode(harness, CLASSIFY_SCRIPT));
  return { harness, maxActive, observed, result };
});

const listsModelsAndClassifiesWithCatalog = Effect.gen(function* () {
  const { harness, maxActive, observed, result } = yield* classifyWithCatalogAuth();
  expect(result.isError).toBe(false);
  expect(yield* fromJsonText(resultText(result))).toEqual({
    cost: 0.001,
    headers: false,
    id: "judge",
    listed: true,
    missing: true,
    probabilities: [0.9, 0.1, 0.9, 0.1, 0.9, 0.1],
    same: "judge",
  });
  expect(observed).toHaveLength(6);
  expect(
    observed.every(
      (entry) => entry.baseUrl === "https://classifier.test/v1" && entry.apiKey === "secret-key",
    ),
  ).toBe(true);

  expect(maxActive()).toBe(4);
  const details = result.details as unknown as CodemodeToolDetails;
  expect(details.calls.map((call) => [call.name, call.args, call.status, call.cost])).toEqual(
    Array.from({ length: 6 }, () => ["models.classify", "scorer/judge", "ok", 0.001]),
  );

  expect(result.usage?.input).toBe(1800);
  expect(result.usage?.cost.total).toBeCloseTo(0.006, 10);
  expect(harness.session.getSessionStats().cost).toBeCloseTo(0.006, 10);
});

const generatesImagesWithCatalogAuthAnd = Effect.gen(function* () {
  const { harness, imageRequests } = yield* awaited(setup4());
  const result = yield* awaited(runCodemode(harness, IMAGES_SCRIPT));
  expect(result.isError).toBe(false);
  const [header, text, ...rest] = (yield* checkSavedImages(resultText(result))).split("\n");
  expect(header).toBe("==> text 1/2 <==");
  expect(text).toBe("painted a fox");
  expect(rest[0]).toBe("<saved>");
  expect(rest[1]).toBe("<image>");
  expect(rest[2]).toBe("==> text 2/2 <==");
  expect(yield* fromJsonText(rest.slice(3).join("\n"))).toEqual({
    failed: ["error", "painter exploded"],
    id: "painter",
    stopReason: "stop",
    wrongType:
      '"scorer/judge" is a classifier model, not an image model. List the image models you can use with models.getAvailableOfType("image").',
  });
  expect(result.content[2]).toEqual({
    data: TINY_PNG_BASE64,
    mimeType: "image/png",
    type: "image",
  });
  expect(imageRequests.map((request) => [request.baseUrl, request.apiKey])).toEqual([
    ["https://images.test/v1", "secret-key"],
    ["https://images.test/v1", "secret-key"],
  ]);
  expect(imageRequests[0]?.input).toEqual([
    { text: "a fox", type: "text" },
    { data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" },
  ]);
  const details = result.details as unknown as CodemodeToolDetails;
  expect(
    details.calls.map((call) => [call.name, call.args, call.status, call.cost, call.error]),
  ).toEqual([
    ["models.generateImages", "scorer/painter", "ok", 0.04, undefined],
    ["models.generateImages", "scorer/painter", "error", undefined, "painter exploded"],
  ]);
  expect(result.usage?.cost.total).toBeCloseTo(0.04, 10);
  expect(harness.session.getSessionStats().cost).toBeCloseTo(0.04, 10);
});

const notesGeneratedImagesThatTheScript = Effect.gen(function* () {
  const { harness } = yield* awaited(setup4());
  const result = yield* awaited(runCodemode(harness, NOTES_SCRIPT));
  expect(result.isError).toBe(false);
  expect(resultText(result)).toBe(
    "stop\nNote: models.generateImages() returned 1 image that the script did not show. Show each image block of result.output with image(block).",
  );
});

describe("codemode models", () => {
  afterEach(cleanupModelHarnesses);
  it("declares models only for the session's own codemode tool", () =>
    runTest(declaresModelsOnlyForTheSession));
  it("lists models and classifies with catalog auth, ignoring script-supplied fields", () =>
    runTest(listsModelsAndClassifiesWithCatalog));
  it("generates images with catalog auth and attaches them through image()", () =>
    runTest(generatesImagesWithCatalogAuthAnd));
  it("notes generated images that the script did not show", () =>
    runTest(notesGeneratedImagesThatTheScript));
});
