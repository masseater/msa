import { describe, expect, test } from "vite-plus/test";

import type { Args } from "../src/cli/args.ts";
import { buildInitialMessage } from "../src/cli/initial-message.ts";

function createArgs(messages: string[] = []): Args {
  return {
    diagnostics: [],
    fileArgs: [],
    messages: [...messages],
    unknownFlags: new Map(),
  };
}

const mergesPipedStdinWithTheFirstCli = () => {
  const parsed = createArgs(["Summarize the text given"]);
  const result = buildInitialMessage({
    parsed,
    stdinContent: "README contents\n",
  });

  expect(result.initialMessage).toBe("README contents\nSummarize the text given");
  expect(parsed.messages).toEqual([]);
};

const usesStdinAsTheInitialPromptWhen = () => {
  const parsed = createArgs();
  const result = buildInitialMessage({
    parsed,
    stdinContent: "README contents",
  });

  expect(result.initialMessage).toBe("README contents");
  expect(parsed.messages).toEqual([]);
};

const combinesStdinFileTextAndFirstCli = () => {
  const parsed = createArgs(["Explain it", "Second message"]);
  const result = buildInitialMessage({
    fileText: "file\n",
    parsed,
    stdinContent: "stdin\n",
  });

  expect(result.initialMessage).toBe("stdin\nfile\nExplain it");
  expect(parsed.messages).toEqual(["Second message"]);
};

describe("buildInitialMessage", () => {
  test(
    "merges piped stdin with the first CLI message into one prompt",
    mergesPipedStdinWithTheFirstCli,
  );

  test(
    "uses stdin as the initial prompt when no CLI message is present",
    usesStdinAsTheInitialPromptWhen,
  );

  test(
    "combines stdin, file text, and first CLI message in one prompt",
    combinesStdinFileTextAndFirstCli,
  );
});
