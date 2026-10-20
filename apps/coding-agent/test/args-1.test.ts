import { describe, expect, test } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";

const parsesVersionFlag = () => {
  const result = parseArgs(["--version"]);
  expect(result.version).toBe(true);
};

const parsesVShorthand = () => {
  const result = parseArgs(["-v"]);
  expect(result.version).toBe(true);
};

const versionTakesPrecedenceOverOtherArgs = () => {
  const result = parseArgs(["--version", "--help", "some message"]);
  expect(result.version).toBe(true);
  expect(result.help).toBe(true);
  expect(result.messages).toContain("some message");
};

const parsesHelpFlag = () => {
  const result = parseArgs(["--help"]);
  expect(result.help).toBe(true);
};

const parsesHShorthand = () => {
  const result = parseArgs(["-h"]);
  expect(result.help).toBe(true);
};

const parsesPrintFlag = () => {
  const result = parseArgs(["--print"]);
  expect(result.print).toBe(true);
};

const parsesPShorthand = () => {
  const result = parseArgs(["-p"]);
  expect(result.print).toBe(true);
};

const parsesPromptAfterPEvenWhenIt = () => {
  const prompt = "---\ntitle: hello\n---\nSay hi.";
  const result = parseArgs(["-p", prompt]);
  expect(result.print).toBe(true);
  expect(result.messages).toEqual([prompt]);
  expect(result.unknownFlags.size).toBe(0);
};

const doesNotConsumeOptionsAfterPAs = () => {
  const result = parseArgs(["-p", "--provider", "openai", "Say hi."]);
  expect(result.print).toBe(true);
  expect(result.provider).toBe("openai");
  expect(result.messages).toEqual(["Say hi."]);
};

const parsesContinueFlag = () => {
  const result = parseArgs(["--continue"]);
  expect(result.continue).toBe(true);
};

const parsesCShorthand = () => {
  const result = parseArgs(["-c"]);
  expect(result.continue).toBe(true);
};

const parsesResumeFlag = () => {
  const result = parseArgs(["--resume"]);
  expect(result.resume).toBe(true);
};

const parsesRShorthand = () => {
  const result = parseArgs(["-r"]);
  expect(result.resume).toBe(true);
};

const parsesProvider = () => {
  const result = parseArgs(["--provider", "openai"]);
  expect(result.provider).toBe("openai");
};

const parsesModel = () => {
  const result = parseArgs(["--model", "gpt-4o"]);
  expect(result.model).toBe("gpt-4o");
};

const parsesApiKey = () => {
  const result = parseArgs(["--api-key", "sk-test-key"]);
  expect(result.apiKey).toBe("sk-test-key");
};

const parsesSystemPrompt = () => {
  const result = parseArgs(["--system-prompt", "You are a helpful assistant"]);
  expect(result.systemPrompt).toBe("You are a helpful assistant");
};

const parsesAppendSystemPrompt = () => {
  const result = parseArgs(["--append-system-prompt", "Additional context"]);
  expect(result.appendSystemPrompt).toEqual(["Additional context"]);
};

const parsesMultipleAppendSystemPromptFlags = () => {
  const result = parseArgs([
    "--append-system-prompt",
    "Context A",
    "--append-system-prompt",
    "Context B",
  ]);
  expect(result.appendSystemPrompt).toEqual(["Context A", "Context B"]);
};

const parsesSession = () => {
  const result = parseArgs(["--session", "/path/to/session.jsonl"]);
  expect(result.session).toBe("/path/to/session.jsonl");
};

const parsesSessionId = () => {
  const result = parseArgs(["--session-id", "orchestrated-session"]);
  expect(result.sessionId).toBe("orchestrated-session");
};

const parsesFork = () => {
  const result = parseArgs(["--fork", "1234abcd"]);
  expect(result.fork).toBe("1234abcd");
  expect(result.messages).toEqual([]);
};

const parsesExport = () => {
  const result = parseArgs(["--export", "session.jsonl"]);
  expect(result.export).toBe("session.jsonl");
};

const parsesThinking = () => {
  const result = parseArgs(["--thinking", "high"]);
  expect(result.thinking).toBe("high");
};

const parsesModelsAsCommaSeparatedList = () => {
  const result = parseArgs(["--models", "gpt-4o,claude-sonnet,gemini-pro"]);
  expect(result.models).toEqual(["gpt-4o", "claude-sonnet", "gemini-pro"]);
};

const ignoresEmptyEntriesInModels = () => {
  const result = parseArgs(["--models", "gpt-4o, ,claude-sonnet,"]);
  expect(result.models).toEqual(["gpt-4o", "claude-sonnet"]);
};

describe("parseArgs", () => {
  describe("--version flag", () => {
    test("parses --version flag", parsesVersionFlag);

    test("parses -v shorthand", parsesVShorthand);

    test("--version takes precedence over other args", versionTakesPrecedenceOverOtherArgs);
  });

  describe("--help flag", () => {
    test("parses --help flag", parsesHelpFlag);

    test("parses -h shorthand", parsesHShorthand);
  });

  describe("--print flag", () => {
    test("parses --print flag", parsesPrintFlag);

    test("parses -p shorthand", parsesPShorthand);

    test(
      "parses prompt after -p even when it starts with YAML frontmatter",
      parsesPromptAfterPEvenWhenIt,
    );

    test("does not consume options after -p as prompts", doesNotConsumeOptionsAfterPAs);
  });

  describe("--continue flag", () => {
    test("parses --continue flag", parsesContinueFlag);

    test("parses -c shorthand", parsesCShorthand);
  });

  describe("--resume flag", () => {
    test("parses --resume flag", parsesResumeFlag);

    test("parses -r shorthand", parsesRShorthand);
  });
});

describe("parseArgs", () => {
  describe("flags with values", () => {
    test("parses --provider", parsesProvider);

    test("parses --model", parsesModel);

    test("parses --api-key", parsesApiKey);

    test("parses --system-prompt", parsesSystemPrompt);

    test("parses --append-system-prompt", parsesAppendSystemPrompt);

    test("parses multiple --append-system-prompt flags", parsesMultipleAppendSystemPromptFlags);

    test("parses --session", parsesSession);

    test("parses --session-id", parsesSessionId);

    test("parses --fork", parsesFork);

    test("parses --export", parsesExport);

    test("parses --thinking", parsesThinking);

    test("parses --models as comma-separated list", parsesModelsAsCommaSeparatedList);

    test("ignores empty entries in --models", ignoresEmptyEntriesInModels);
  });
});
