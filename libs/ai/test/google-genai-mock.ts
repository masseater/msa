import { Stream } from "effect";

const googleGenAiMock = {
  constructorCalls: [] as Array<Record<string, unknown>>,
  finishReason: "MALFORMED_FUNCTION_CALL",
  includeFunctionCall: false,
  streamChunks: undefined as Array<Record<string, unknown>> | undefined,
};

const functionCallContent = {
  parts: [{ functionCall: { args: { value: "truncated" }, id: "call-1", name: "echo" } }],
};

const defaultChunk = (): Record<string, unknown> => ({
  candidates: [
    {
      finishReason: googleGenAiMock.finishReason,
      ...(googleGenAiMock.includeFunctionCall ? { content: functionCallContent } : {}),
    },
  ],
  responseId: "google-response-id",
  usageMetadata: { candidatesTokenCount: 0, promptTokenCount: 1, totalTokenCount: 1 },
});

class GoogleGenAI {
  constructor(config: Record<string, unknown>) {
    googleGenAiMock.constructorCalls.push(config);
  }

  models = {
    generateContentStream: () =>
      Stream.toAsyncIterable(Stream.fromIterable(googleGenAiMock.streamChunks ?? [defaultChunk()])),
  };
}

const googleGenAiMockModule = {
  FinishReason: {
    BLOCKLIST: "BLOCKLIST",
    FINISH_REASON_UNSPECIFIED: "FINISH_REASON_UNSPECIFIED",
    IMAGE_OTHER: "IMAGE_OTHER",
    IMAGE_PROHIBITED_CONTENT: "IMAGE_PROHIBITED_CONTENT",
    IMAGE_RECITATION: "IMAGE_RECITATION",
    IMAGE_SAFETY: "IMAGE_SAFETY",
    LANGUAGE: "LANGUAGE",
    MALFORMED_FUNCTION_CALL: "MALFORMED_FUNCTION_CALL",
    MAX_TOKENS: "MAX_TOKENS",
    NO_IMAGE: "NO_IMAGE",
    OTHER: "OTHER",
    PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
    RECITATION: "RECITATION",
    SAFETY: "SAFETY",
    SPII: "SPII",
    STOP: "STOP",
    UNEXPECTED_TOOL_CALL: "UNEXPECTED_TOOL_CALL",
  },
  FunctionCallingConfigMode: { ANY: "ANY", AUTO: "AUTO", NONE: "NONE", VALIDATED: "VALIDATED" },
  GoogleGenAI,
  ResourceScope: { COLLECTION: "COLLECTION" },
  ThinkingLevel: {
    HIGH: "HIGH",
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    MINIMAL: "MINIMAL",
    THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
  },
  googleGenAiMock,
};

export default googleGenAiMockModule;
