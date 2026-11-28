import { describe, expect, test } from "vite-plus/test";

import args from "../src/cli/args.ts";

const { parseArgs } = args;

const versionTakesPrecedenceOverOtherArgs = () => {
  const result = parseArgs(["--version", "--help", "some message"]);
  expect(result.version).toBe(true);
  expect(result.help).toBe(true);
  expect(result.messages).toContain("some message");
};

const parsesPromptAfterPEvenWhenIt = () => {
  const prompt = "---\ntitle: hello\n---\nSay hi.";
  const result = parseArgs(["-p", prompt]);
  expect(result.print).toBe(true);
  expect(result.messages).toEqual([prompt]);
  expect(result.unknownFlags.size).toBe(0);
};

const booleanFlagCases = [
  { argv: ["--version"], expected: { version: true }, name: "--version flag" },
  { argv: ["-v"], expected: { version: true }, name: "-v shorthand" },
  { argv: ["--help"], expected: { help: true }, name: "--help flag" },
  { argv: ["-h"], expected: { help: true }, name: "-h shorthand" },
  { argv: ["--print"], expected: { print: true }, name: "--print flag" },
  { argv: ["-p"], expected: { print: true }, name: "-p shorthand" },
  { argv: ["--continue"], expected: { continue: true }, name: "--continue flag" },
  { argv: ["-c"], expected: { continue: true }, name: "-c shorthand" },
  { argv: ["--resume"], expected: { resume: true }, name: "--resume flag" },
  { argv: ["-r"], expected: { resume: true }, name: "-r shorthand" },
];

const valueFlagCases = [
  {
    argv: ["-p", "--provider", "openai", "Say hi."],
    expected: { messages: ["Say hi."], print: true, provider: "openai" },
    name: "options after -p instead of consuming them as the prompt",
  },
  { argv: ["--provider", "openai"], expected: { provider: "openai" }, name: "--provider" },
  { argv: ["--model", "gpt-4o"], expected: { model: "gpt-4o" }, name: "--model" },
  {
    argv: ["--api-key", "sk-test-key"],
    expected: { apiKey: "sk-test-key" },
    name: "--api-key",
  },
  {
    argv: ["--system-prompt", "You are a helpful assistant"],
    expected: { systemPrompt: "You are a helpful assistant" },
    name: "--system-prompt",
  },
  {
    argv: ["--append-system-prompt", "Additional context"],
    expected: { appendSystemPrompt: ["Additional context"] },
    name: "--append-system-prompt",
  },
  {
    argv: ["--append-system-prompt", "Context A", "--append-system-prompt", "Context B"],
    expected: { appendSystemPrompt: ["Context A", "Context B"] },
    name: "multiple --append-system-prompt flags",
  },
  {
    argv: ["--session", "/path/to/session.jsonl"],
    expected: { session: "/path/to/session.jsonl" },
    name: "--session",
  },
  {
    argv: ["--session-id", "orchestrated-session"],
    expected: { sessionId: "orchestrated-session" },
    name: "--session-id",
  },
  {
    argv: ["--fork", "1234abcd"],
    expected: { fork: "1234abcd", messages: [] },
    name: "--fork",
  },
  {
    argv: ["--export", "session.jsonl"],
    expected: { export: "session.jsonl" },
    name: "--export",
  },
  { argv: ["--thinking", "high"], expected: { thinking: "high" }, name: "--thinking" },
  {
    argv: ["--models", "gpt-4o,claude-sonnet,gemini-pro"],
    expected: { models: ["gpt-4o", "claude-sonnet", "gemini-pro"] },
    name: "--models as comma-separated list",
  },
];

describe("parseArgs", () => {
  test.each(booleanFlagCases)("parses $name", ({ argv, expected }) => {
    expect(parseArgs(argv)).toMatchObject(expected);
  });

  describe("--version flag", () => {
    test("--version takes precedence over other args", versionTakesPrecedenceOverOtherArgs);
  });

  describe("--print flag", () => {
    test(
      "parses prompt after -p even when it starts with YAML frontmatter",
      parsesPromptAfterPEvenWhenIt,
    );
  });
});

describe("parseArgs", () => {
  describe("flags with values", () => {
    test.each(valueFlagCases)("parses $name", ({ argv, expected }) => {
      expect(parseArgs(argv)).toMatchObject(expected);
    });

    test("ignores empty entries in --models", () => {
      expect(parseArgs(["--models", "gpt-4o, ,claude-sonnet,"]).models).toEqual([
        "gpt-4o",
        "claude-sonnet",
      ]);
    });
  });
});
