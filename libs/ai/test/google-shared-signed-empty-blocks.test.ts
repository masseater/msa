import { describe, expect, it } from "vite-plus/test";

import googleMessages from "../src/api/google-messages.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";

const { currentTimeMillis } = clock;
const { convertMessages } = googleMessages;
const { normalizeContext } = transcript;

function makeModel(id = "gemini-3-pro-preview"): typesModule.Model<"google-generative-ai"> {
  return {
    api: "google-generative-ai",
    baseUrl: "https://example.com",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 8192,
    name: id,
    provider: "google",
    reasoning: true,
  };
}

const VALID_SIG = "AAAAAAAAAAAAAAAAAAAAAA==";

function makeContext(
  model: { api: string; provider: string; id: string },
  content: typesModule.AssistantMessage["content"],
): typesModule.Context {
  const now = currentTimeMillis();
  return {
    messages: [
      { content: "Hi", role: "user", timestamp: now },
      {
        api: model.api as typesModule.AssistantMessage["api"],
        content,
        model: model.id,
        provider: model.provider,
        role: "assistant",
        stopReason: "toolUse",
        timestamp: now,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
    ],
  };
}

describe("google-shared convertMessages — signed empty blocks", () => {
  it("keeps a signed empty thinking block so its signature is echoed back", () => {
    const model = makeModel();
    const contents = convertMessages(
      model,
      normalizeContext(
        makeContext(model, [
          { thinking: "", thinkingSignature: VALID_SIG, type: "thinking" },
          { arguments: { command: "ls" }, id: "call_1", name: "bash", type: "toolCall" },
        ]),
      ),
    );
    const modelTurn = contents.find((c) => c.role === "model");
    const signed = modelTurn?.parts?.filter((p) => p.thoughtSignature === VALID_SIG) ?? [];
    expect(signed).toHaveLength(1);
    expect(signed[0]?.thought).toBe(true);
  });

  it("keeps a signed empty text block the same way", () => {
    const model = makeModel();
    const contents = convertMessages(
      model,
      normalizeContext(
        makeContext(model, [
          { text: "", textSignature: VALID_SIG, type: "text" },
          { arguments: { command: "ls" }, id: "call_1", name: "bash", type: "toolCall" },
        ]),
      ),
    );
    const modelTurn = contents.find((c) => c.role === "model");
    const signed = modelTurn?.parts?.filter((p) => p.thoughtSignature === VALID_SIG) ?? [];
    expect(signed).toHaveLength(1);
  });
});

describe("google-shared convertMessages — signed empty blocks", () => {
  it("still drops unsigned empty blocks", () => {
    const model = makeModel();
    const contents = convertMessages(
      model,
      normalizeContext(
        makeContext(model, [
          { thinking: "", type: "thinking" },
          { text: "   ", type: "text" },
          { arguments: { command: "ls" }, id: "call_1", name: "bash", type: "toolCall" },
        ]),
      ),
    );
    const modelTurn = contents.find((c) => c.role === "model");
    expect(modelTurn?.parts).toHaveLength(1);
    expect(modelTurn?.parts?.[0]?.functionCall).toBeTruthy();
  });
});

describe("google-shared convertMessages — signed empty blocks", () => {
  it("still drops signed empty blocks from a different provider/model (signature unusable)", () => {
    const model = makeModel();
    const contents = convertMessages(
      model,
      normalizeContext(
        makeContext({ ...model, id: "other-model" }, [
          { thinking: "", thinkingSignature: VALID_SIG, type: "thinking" },
          { text: "", textSignature: VALID_SIG, type: "text" },
          { arguments: { command: "ls" }, id: "call_1", name: "bash", type: "toolCall" },
        ]),
      ),
    );
    const modelTurn = contents.find((c) => c.role === "model");
    expect(modelTurn?.parts).toHaveLength(1);
    expect(modelTurn?.parts?.[0]?.functionCall).toBeTruthy();
    expect(JSON.stringify(modelTurn)).not.toContain(VALID_SIG);
  });
});
