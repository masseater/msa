import { describe, expect, test } from "vite-plus/test";

import args from "../src/cli/args.ts";

const { parseArgs } = args;

const toolFlagCases = [
  { argv: ["--no-tools"], expected: { noTools: true }, name: "--no-tools flag" },
  { argv: ["-nt"], expected: { noTools: true }, name: "-nt shorthand" },
  {
    argv: ["--no-builtin-tools"],
    expected: { noBuiltinTools: true },
    name: "--no-builtin-tools flag",
  },
  { argv: ["-nbt"], expected: { noBuiltinTools: true }, name: "-nbt shorthand" },
  { argv: ["--tools", "read,bash"], expected: { tools: ["read", "bash"] }, name: "--tools flag" },
  { argv: ["-t", "read,bash"], expected: { tools: ["read", "bash"] }, name: "-t shorthand" },
  {
    argv: ["-t", "+codemode,-write"],
    expected: { diagnostics: [], tools: ["+codemode", "-write"] },
    name: "+name and -name tool modifiers",
  },
  {
    argv: ["--exclude-tools", "read,bash"],
    expected: { excludeTools: ["read", "bash"] },
    name: "--exclude-tools flag",
  },
  {
    argv: ["-xt", "read,bash"],
    expected: { excludeTools: ["read", "bash"] },
    name: "-xt shorthand",
  },
  {
    argv: ["--no-tools", "--tools", "read,bash"],
    expected: { noTools: true, tools: ["read", "bash"] },
    name: "--no-tools with explicit --tools flags",
  },
  {
    argv: ["--no-builtin-tools", "--tools", "read,bash"],
    expected: { noBuiltinTools: true, tools: ["read", "bash"] },
    name: "--no-builtin-tools with explicit --tools flags",
  },
];

const rejectsTheRemovedOrchestratorFlag = () => {
  const result = parseArgs(["--orchestrator"]);
  expect(result.tools).toBeUndefined();
  expect(result.diagnostics).toEqual([
    {
      message:
        "--orchestrator is the default: the orchestrator tools are always enabled. Remove the flag.",
      type: "error",
    },
  ]);
};

const rejectsToolNamesMixedWithModifiers = () => {
  const result = parseArgs(["--tools", "read,+codemode"]);
  expect(result.tools).toBeUndefined();
  expect(result.diagnostics).toEqual([
    {
      message: "--tools: tool names cannot be mixed with +name or -name entries",
      type: "error" as const,
    },
  ]);
};

const rejectsPatternsInToolModifiers = () => {
  const result = parseArgs(["-t", "+mcp__github__*"]);
  expect(result.tools).toBeUndefined();
  expect(result.diagnostics).toEqual([
    {
      message: "-t: +name and -name entries take exact tool names, not patterns: +mcp__github__*",
      type: "error" as const,
    },
  ]);
};

const parsesPlainTextMessages = () => {
  const result = parseArgs(["hello", "world"]);
  expect(result.messages).toEqual(["hello", "world"]);
};

const parsesFileArguments = () => {
  const result = parseArgs(["@README.md", "@src/main.ts"]);
  expect(result.fileArgs).toEqual(["README.md", "src/main.ts"]);
};

const parsesMixedMessagesAndFileArgs = () => {
  const result = parseArgs(["@file.txt", "explain this", "@image.png"]);
  expect(result.fileArgs).toEqual(["file.txt", "image.png"]);
  expect(result.messages).toEqual(["explain this"]);
};

const capturesUnknownLongFlagsWithStringValues = () => {
  const result = parseArgs(["--unknown-flag", "message"]);
  expect(result.messages).toEqual([]);
  expect(result.unknownFlags.get("unknown-flag")).toBe("message");
};

const capturesUnknownBooleanLongFlags = () => {
  const result = parseArgs(["--unknown-flag"]);
  expect(result.unknownFlags.get("unknown-flag")).toBe(true);
};

const capturesUnknownLongFlagsWithEqualsSyntax = () => {
  const result = parseArgs(["--unknown-flag=value"]);
  expect(result.unknownFlags.get("unknown-flag")).toBe("value");
};

const parsesMultipleFlagsTogether = () => {
  const result = parseArgs([
    "--provider",
    "anthropic-api",
    "--model",
    "claude-sonnet",
    "--print",
    "--thinking",
    "high",
    "@prompt.md",
    "Do the task",
  ]);
  expect(result.provider).toBe("anthropic-api");
  expect(result.model).toBe("claude-sonnet");
  expect(result.print).toBe(true);
  expect(result.thinking).toBe("high");
  expect(result.fileArgs).toEqual(["prompt.md"]);
  expect(result.messages).toEqual(["Do the task"]);
};

describe("parseArgs", () => {
  describe("tool flags", () => {
    test.each(toolFlagCases)("parses $name", ({ argv, expected }) => {
      expect(parseArgs(argv)).toMatchObject(expected);
    });

    test("rejects the removed --orchestrator flag", rejectsTheRemovedOrchestratorFlag);

    test("rejects tool names mixed with modifiers", rejectsToolNamesMixedWithModifiers);

    test("rejects patterns in tool modifiers", rejectsPatternsInToolModifiers);
  });
});

describe("parseArgs", () => {
  describe("messages and file args", () => {
    test("parses plain text messages", parsesPlainTextMessages);

    test("parses @file arguments", parsesFileArguments);

    test("parses mixed messages and file args", parsesMixedMessagesAndFileArgs);

    test(
      "captures unknown long flags with string values",
      capturesUnknownLongFlagsWithStringValues,
    );

    test("captures unknown boolean long flags", capturesUnknownBooleanLongFlags);

    test(
      "captures unknown long flags with equals syntax",
      capturesUnknownLongFlagsWithEqualsSyntax,
    );
  });

  describe("complex combinations", () => {
    test("parses multiple flags together", parsesMultipleFlagsTogether);
  });
});
