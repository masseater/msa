import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import node from "../src/env/node.ts";
import codemodeModelsSupport from "./codemode-models-support.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import taskSupport from "./task-support.ts";

const { NodeExecutionEnv } = node;

const { modelsChat, run } = codemodeModelsSupport;
const { awaited, fromJsonText } = effectSupport;
const { makeTempDir, removeDir } = platformSupport;
const { deferred } = taskSupport;

const readsModelCatalog = Effect.gen(function* () {
  const chat = modelsChat();
  const { text } = yield* run(
    chat,
    `const classifiers = await models.getModelsOfType("classifier", "test");
			const one = await models.getModelOfType("classifier", "test", "judge");
			const available = await models.getAvailableOfType("image");
			return [classifiers.map((m) => m.id), one.id, "headers" in one, available.map((m) => m.id)];`,
  );
  expect(yield* fromJsonText(text)).toEqual([["judge"], "judge", false, ["painter"]]);
});

const classifiesThroughInternal = Effect.gen(function* () {
  const chat = modelsChat();
  const { text, message, usage } = yield* run(
    chat,
    `const model = await models.getModelOfType("classifier", "test", "judge");
			const result = await models.classify(model, {
				state: { text: "hi" },
				questions: { good: { type: "bool", instructions: "Is it good?", criteria: { true: "yes", false: "no" } } },
			});
			const found = (await searchTools("classify generate images models")).length;
			const described = (await describeTool("msa.codemode.models.classify")) !== undefined;
			return [result.stopReason, result.answers.good.value, Object.keys(tools).some((name) => name.includes("models")), ALL_TOOLS.some((tool) => tool.name.includes("models")), found, described];`,
  );
  expect(yield* fromJsonText(text)).toEqual(["stop", true, false, false, 0, false]);
  expect(chat.calls.classify).toBe(1);
  expect((message.details as { calls: { name: string; status: string }[] }).calls).toMatchObject([
    { name: "models.classify", status: "ok" },
  ]);
  expect(usage?.tools["msa.codemode.models.classify"]?.cost.total).toBeCloseTo(0.0012);
});

describe("code mode models.*", () => {
  it("reads the model catalog without credentials in headers", () =>
    Effect.runPromise(readsModelCatalog));

  it("classifies through an internal tool: a nested call with its usage, hidden from tools and listings", () =>
    Effect.runPromise(classifiesThroughInternal));
});

const resolvesModelCall = Effect.gen(function* () {
  const chat = modelsChat();
  const { text, message } = yield* run(
    chat,
    `const model = await models.getModelOfType("classifier", "test", "judge");
			const result = await models.classify(model, {
				state: { fail: true },
				questions: { good: { type: "bool", instructions: "?", criteria: { true: "y", false: "n" } } },
			});
			return [result.stopReason, result.errorMessage];`,
  );
  expect(yield* fromJsonText(text)).toEqual(["error", "quota exceeded"]);
  expect((message.details as { calls: { name: string; status: string }[] }).calls).toMatchObject([
    { name: "models.classify", status: "error" },
  ]);
});

const rejectsBadClassifier = Effect.gen(function* () {
  const chat = modelsChat();
  const { text } = yield* run(
    chat,
    `const model = await models.getModelOfType("classifier", "test", "judge");
			try { await models.classify(model, { prompt: "x" }); } catch (error) { return error.message; }`,
  );
  expect(text).toContain("context.state must be an object");
  expect(text).toContain("Expected context:");
  expect(chat.calls.classify).toBe(0);
});

const runsMostFour = Effect.gen(function* () {
  const chat = modelsChat();
  chat.gate.open = deferred();
  chat.gate.atFour = true;
  const { text } = yield* run(
    chat,
    `const model = await models.getModelOfType("classifier", "test", "judge");
			const context = { state: {}, questions: { good: { type: "bool", instructions: "?", criteria: { true: "y", false: "n" } } } };
			return (await Promise.all(Array.from({ length: 8 }, () => models.classify(model, context)))).length;`,
  );
  expect(text).toBe("8");
  expect(chat.calls.classify).toBe(8);
  expect(chat.calls.maxInFlight).toBe(4);
});

describe("code mode models.*", () => {
  it("resolves a model call that failed with its result, as the coding agent does", () =>
    Effect.runPromise(resolvesModelCall));

  it("rejects a bad classifier context with the expected shape, before any request", () =>
    Effect.runPromise(rejectsBadClassifier));

  it("runs at most four model calls at once", () => Effect.runPromise(runsMostFour));
});

const doesNotStart = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = modelsChat();
  chat.gate.open = deferred();
  const directory = yield* makeTempDir("msa-codemode-models-");
  class SlowTempFiles extends NodeExecutionEnv {
    override createTempDir(prefix: string | undefined, ctx: chordTypes.Context) {
      const superCreateTempDir = super.createTempDir.bind(this);
      return runPromise(
        Effect.gen(function* () {
          chat.gate.open.resolve();
          yield* Effect.sleep(100);
          return yield* awaited(superCreateTempDir(prefix, ctx));
        }),
      );
    }
  }
  yield* Effect.gen(function* () {
    const { text } = yield* run(
      chat,
      `const model = await models.getModelOfType("classifier", "test", "judge");
				const context = { state: {}, questions: { good: { type: "bool", instructions: "?", criteria: { true: "y", false: "n" } } } };
				for (let i = 0; i < 6; i++) models.classify(model, context).catch(() => {});
				// A journaled call after them: by its result, the first four have been launched.
				await models.getModelsOfType("image");
				return "x".repeat(60000);`,
      new SlowTempFiles({ cwd: directory }),
    );
    expect(text).toContain("[Full output: ");
    expect(chat.calls.classify).toBe(4);
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))));
});

describe("code mode models.*", () => {
  it("does not start a model call that waited for a slot after the script ended", () =>
    Effect.runPromise(doesNotStart));
});

const notesGeneratedImages = Effect.gen(function* () {
  const chat = modelsChat();
  const hidden = yield* run(
    chat,
    `const model = await models.getModelOfType("image", "test", "painter");
			const result = await models.generateImages(model, { input: [{ type: "text", text: "a cat" }] });
			return result.output.length;`,
  );
  expect(hidden.text).toContain(
    "Note: models.generateImages() returned 1 image that the script did not show",
  );
  const shown = yield* run(
    modelsChat(),
    `const model = await models.getModelOfType("image", "test", "painter");
			const result = await models.generateImages(model, { input: [{ type: "text", text: "a cat" }] });
			image(result.output[0]);`,
  );
  expect(shown.text).not.toContain("Note:");
  expect(shown.message.content.some((item) => item.type === "image")).toBe(true);
});

describe("code mode models.*", () => {
  it("notes generated images the script did not show", () =>
    Effect.runPromise(notesGeneratedImages));
});
