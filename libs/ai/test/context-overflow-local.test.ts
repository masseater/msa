import { Console, Effect } from "effect";
import { afterAll, beforeAll, describe, expect, inject, it } from "vite-plus/test";

import overflowModule from "../src/utils/overflow.ts";
import contextOverflowSupport from "./context-overflow-support.ts";
import localLlmSupport from "./local-llm-support.ts";

const { isContextOverflow } = overflowModule;

const { expectOverflowDetected, overflow } = contextOverflowSupport;
const { llamaCppModel, lmStudioModel, ollamaModel, startOllama } = localLlmSupport;

const localLlms = inject("localLlms");

const ollamaTruncatesOrReportsOverflow = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* overflow(ollamaModel, "ollama");
      if (response.stopReason === "error") {
        expect(isContextOverflow(response, ollamaModel.contextWindow)).toBe(true);
      } else if (response.usage.input > 0 || response.usage.cacheRead > 0) {
        yield* Console.log(`  Ollama silently truncated input to ${response.usage.input} tokens`);
      }
    }),
  );

describe.skipIf(!localLlms.ollama)("Context overflow on Ollama", () => {
  const stop: { value?: () => Promise<void> } = {};
  beforeAll(() => startOllama().then((stopOllama) => (stop.value = stopOllama)), 600000);
  afterAll(() => stop.value?.());

  it(
    "detects overflow or silent truncation on Ollama",
    { timeout: 300000 },
    ollamaTruncatesOrReportsOverflow,
  );
});

describe("Context overflow on local servers", () => {
  it.skipIf(!localLlms.lmStudio)("detects LM Studio overflow", { timeout: 120000 }, () =>
    expectOverflowDetected(lmStudioModel, "lm-studio"),
  );
  it.skipIf(!localLlms.llamaCpp)("detects llama.cpp overflow", { timeout: 120000 }, () =>
    expectOverflowDetected(llamaCppModel, "llama.cpp"),
  );
});
