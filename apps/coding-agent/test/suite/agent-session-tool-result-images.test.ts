import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;

const normalizeToolResultImages = vi.hoisted(() =>
  vi.fn((content: unknown[]) => Promise.resolve(content)),
);
vi.mock("../../src/utils/tool-result-images.ts", () => ({
  default: { normalizeToolResultImages },
}));

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const screenshotTool: agentTypes.AgentTool = {
  description: "Return a screenshot",
  execute: () =>
    Promise.resolve({
      content: [
        { text: "captured", type: "text" },
        { data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" },
      ],
      details: {},
    }),
  label: "Screenshot",
  name: "screenshot",
  parameters: Type.Object({}),
};

const harnesses: harnessTypes.Harness[] = [];

const passesImageSettingsAndTheCurrent = Effect.gen(function* () {
  const resizeOptions = {
    jpegQuality: 70,
    maxBytes: 500000,
    maxHeight: 1000,
    maxWidth: 1200,
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { images: { autoResize: false } },
      tools: [screenshotTool],
    }),
  );
  harnesses.push(harness);
  if (harness.session.model === undefined) throw new Error("Expected a model");
  harness.session.model.inputLimits = { images: { resize: resizeOptions } };
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("screenshot", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("take a screenshot"));

  expect(normalizeToolResultImages).toHaveBeenCalledWith(expect.any(Array), {
    autoResizeImages: false,
    resizeOptions,
  });
});

const passesImageSettingsAndTheCurrentModel = () =>
  Effect.runPromise(passesImageSettingsAndTheCurrent);

const afterEachHook = () => {
  normalizeToolResultImages.mockClear();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("AgentSession tool result images", () => {
  afterEach(afterEachHook);
  it(
    "passes image settings and the current model profile to tool result normalization",
    passesImageSettingsAndTheCurrentModel,
  );
});
