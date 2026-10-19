import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createHarness, type Harness } from "./harness.ts";

const normalizeToolResultImages = vi.hoisted(() =>
  vi.fn((content: unknown[]) => Promise.resolve(content)),
);
vi.mock("../../src/utils/tool-result-images.ts", () => ({ normalizeToolResultImages }));

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const screenshotTool: AgentTool = {
  name: "screenshot",
  label: "Screenshot",
  description: "Return a screenshot",
  parameters: Type.Object({}),
  execute: () =>
    Promise.resolve({
      content: [
        { type: "text", text: "captured" },
        { type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
      ],
      details: {},
    }),
};

const harnesses: Harness[] = [];

const passesImageSettingsAndTheCurrent = Effect.gen(function* () {
  const resizeOptions = {
    maxWidth: 1200,
    maxHeight: 1000,
    maxBytes: 500000,
    jpegQuality: 70,
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [screenshotTool],
      settings: { images: { autoResize: false } },
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

describe("AgentSession tool result images", () => {
  afterEach(() => {
    normalizeToolResultImages.mockClear();
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("passes image settings and the current model profile to tool result normalization", () =>
    Effect.runPromise(passesImageSettingsAndTheCurrent));
});
