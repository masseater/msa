import { describe, expect, test } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";

const parsesNoToolsFlag = () => {
  const result = parseArgs(["--no-tools"]);
  expect(result.noTools).toBe(true);
};

const parsesNtShorthand = () => {
  const result = parseArgs(["-nt"]);
  expect(result.noTools).toBe(true);
};

const parsesNoBuiltinToolsFlag = () => {
  const result = parseArgs(["--no-builtin-tools"]);
  expect(result.noBuiltinTools).toBe(true);
};

const parsesNbtShorthand = () => {
  const result = parseArgs(["-nbt"]);
  expect(result.noBuiltinTools).toBe(true);
};

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

const parsesToolsFlag = () => {
  const result = parseArgs(["--tools", "read,bash"]);
  expect(result.tools).toEqual(["read", "bash"]);
};

const parsesTShorthand = () => {
  const result = parseArgs(["-t", "read,bash"]);
  expect(result.tools).toEqual(["read", "bash"]);
};

const parsesNameAndNameToolModifiers = () => {
  const result = parseArgs(["-t", "+codemode,-write"]);
  expect(result.tools).toEqual(["+codemode", "-write"]);
  expect(result.diagnostics).toEqual([]);
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

const parsesExcludeToolsFlag = () => {
  const result = parseArgs(["--exclude-tools", "read,bash"]);
  expect(result.excludeTools).toEqual(["read", "bash"]);
};

const parsesXtShorthand = () => {
  const result = parseArgs(["-xt", "read,bash"]);
  expect(result.excludeTools).toEqual(["read", "bash"]);
};

const parsesNoToolsWithExplicitToolsFlags = () => {
  const result = parseArgs(["--no-tools", "--tools", "read,bash"]);
  expect(result.noTools).toBe(true);
  expect(result.tools).toEqual(["read", "bash"]);
};

const parsesNoBuiltinToolsWithExplicitTools = () => {
  const result = parseArgs(["--no-builtin-tools", "--tools", "read,bash"]);
  expect(result.noBuiltinTools).toBe(true);
  expect(result.tools).toEqual(["read", "bash"]);
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
    "anthropic",
    "--model",
    "claude-sonnet",
    "--print",
    "--thinking",
    "high",
    "@prompt.md",
    "Do the task",
  ]);
  expect(result.provider).toBe("anthropic");
  expect(result.model).toBe("claude-sonnet");
  expect(result.print).toBe(true);
  expect(result.thinking).toBe("high");
  expect(result.fileArgs).toEqual(["prompt.md"]);
  expect(result.messages).toEqual(["Do the task"]);
};

describe("parseArgs", () => {
  describe("tool flags", () => {
    test("parses --no-tools flag", parsesNoToolsFlag);

    test("parses -nt shorthand", parsesNtShorthand);

    test("parses --no-builtin-tools flag", parsesNoBuiltinToolsFlag);

    test("parses -nbt shorthand", parsesNbtShorthand);

    test("rejects the removed --orchestrator flag", rejectsTheRemovedOrchestratorFlag);

    test("parses --tools flag", parsesToolsFlag);

    test("parses -t shorthand", parsesTShorthand);

    test("parses +name and -name tool modifiers", parsesNameAndNameToolModifiers);

    test("rejects tool names mixed with modifiers", rejectsToolNamesMixedWithModifiers);

    test("rejects patterns in tool modifiers", rejectsPatternsInToolModifiers);

    test("parses --exclude-tools flag", parsesExcludeToolsFlag);

    test("parses -xt shorthand", parsesXtShorthand);

    test("parses --no-tools with explicit --tools flags", parsesNoToolsWithExplicitToolsFlags);

    test(
      "parses --no-builtin-tools with explicit --tools flags",
      parsesNoBuiltinToolsWithExplicitTools,
    );
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
