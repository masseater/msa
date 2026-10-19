import { describe, expect, test } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
  describe("tool flags", () => {
    test("parses --no-tools flag", () => {
      const result = parseArgs(["--no-tools"]);
      expect(result.noTools).toBe(true);
    });

    test("parses -nt shorthand", () => {
      const result = parseArgs(["-nt"]);
      expect(result.noTools).toBe(true);
    });

    test("parses --no-builtin-tools flag", () => {
      const result = parseArgs(["--no-builtin-tools"]);
      expect(result.noBuiltinTools).toBe(true);
    });

    test("parses -nbt shorthand", () => {
      const result = parseArgs(["-nbt"]);
      expect(result.noBuiltinTools).toBe(true);
    });

    test("rejects the removed --orchestrator flag", () => {
      const result = parseArgs(["--orchestrator"]);
      expect(result.tools).toBeUndefined();
      expect(result.diagnostics).toEqual([
        {
          type: "error",
          message:
            "--orchestrator is the default: the orchestrator tools are always enabled. Remove the flag.",
        },
      ]);
    });

    test("parses --tools flag", () => {
      const result = parseArgs(["--tools", "read,bash"]);
      expect(result.tools).toEqual(["read", "bash"]);
    });

    test("parses -t shorthand", () => {
      const result = parseArgs(["-t", "read,bash"]);
      expect(result.tools).toEqual(["read", "bash"]);
    });

    test("parses +name and -name tool modifiers", () => {
      const result = parseArgs(["-t", "+codemode,-write"]);
      expect(result.tools).toEqual(["+codemode", "-write"]);
      expect(result.diagnostics).toEqual([]);
    });

    test("rejects tool names mixed with modifiers", () => {
      const result = parseArgs(["--tools", "read,+codemode"]);
      expect(result.tools).toBeUndefined();
      expect(result.diagnostics).toEqual([
        {
          type: "error" as const,
          message: "--tools: tool names cannot be mixed with +name or -name entries",
        },
      ]);
    });

    test("rejects patterns in tool modifiers", () => {
      const result = parseArgs(["-t", "+mcp__github__*"]);
      expect(result.tools).toBeUndefined();
      expect(result.diagnostics).toEqual([
        {
          type: "error" as const,
          message:
            "-t: +name and -name entries take exact tool names, not patterns: +mcp__github__*",
        },
      ]);
    });

    test("parses --exclude-tools flag", () => {
      const result = parseArgs(["--exclude-tools", "read,bash"]);
      expect(result.excludeTools).toEqual(["read", "bash"]);
    });

    test("parses -xt shorthand", () => {
      const result = parseArgs(["-xt", "read,bash"]);
      expect(result.excludeTools).toEqual(["read", "bash"]);
    });

    test("parses --no-tools with explicit --tools flags", () => {
      const result = parseArgs(["--no-tools", "--tools", "read,bash"]);
      expect(result.noTools).toBe(true);
      expect(result.tools).toEqual(["read", "bash"]);
    });

    test("parses --no-builtin-tools with explicit --tools flags", () => {
      const result = parseArgs(["--no-builtin-tools", "--tools", "read,bash"]);
      expect(result.noBuiltinTools).toBe(true);
      expect(result.tools).toEqual(["read", "bash"]);
    });
  });
  describe("messages and file args", () => {
    test("parses plain text messages", () => {
      const result = parseArgs(["hello", "world"]);
      expect(result.messages).toEqual(["hello", "world"]);
    });

    test("parses @file arguments", () => {
      const result = parseArgs(["@README.md", "@src/main.ts"]);
      expect(result.fileArgs).toEqual(["README.md", "src/main.ts"]);
    });

    test("parses mixed messages and file args", () => {
      const result = parseArgs(["@file.txt", "explain this", "@image.png"]);
      expect(result.fileArgs).toEqual(["file.txt", "image.png"]);
      expect(result.messages).toEqual(["explain this"]);
    });

    test("captures unknown long flags with string values", () => {
      const result = parseArgs(["--unknown-flag", "message"]);
      expect(result.messages).toEqual([]);
      expect(result.unknownFlags.get("unknown-flag")).toBe("message");
    });

    test("captures unknown boolean long flags", () => {
      const result = parseArgs(["--unknown-flag"]);
      expect(result.unknownFlags.get("unknown-flag")).toBe(true);
    });

    test("captures unknown long flags with equals syntax", () => {
      const result = parseArgs(["--unknown-flag=value"]);
      expect(result.unknownFlags.get("unknown-flag")).toBe("value");
    });
  });
  describe("complex combinations", () => {
    test("parses multiple flags together", () => {
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
    });
  });
});
