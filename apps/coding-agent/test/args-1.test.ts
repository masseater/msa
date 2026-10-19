import { describe, expect, test } from "vite-plus/test";

import { normalizeSessionName, parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
  describe("--version flag", () => {
    test("parses --version flag", () => {
      const result = parseArgs(["--version"]);
      expect(result.version).toBe(true);
    });

    test("parses -v shorthand", () => {
      const result = parseArgs(["-v"]);
      expect(result.version).toBe(true);
    });

    test("--version takes precedence over other args", () => {
      const result = parseArgs(["--version", "--help", "some message"]);
      expect(result.version).toBe(true);
      expect(result.help).toBe(true);
      expect(result.messages).toContain("some message");
    });
  });
  describe("--help flag", () => {
    test("parses --help flag", () => {
      const result = parseArgs(["--help"]);
      expect(result.help).toBe(true);
    });

    test("parses -h shorthand", () => {
      const result = parseArgs(["-h"]);
      expect(result.help).toBe(true);
    });
  });
  describe("--print flag", () => {
    test("parses --print flag", () => {
      const result = parseArgs(["--print"]);
      expect(result.print).toBe(true);
    });

    test("parses -p shorthand", () => {
      const result = parseArgs(["-p"]);
      expect(result.print).toBe(true);
    });

    test("parses prompt after -p even when it starts with YAML frontmatter", () => {
      const prompt = "---\ntitle: hello\n---\nSay hi.";
      const result = parseArgs(["-p", prompt]);
      expect(result.print).toBe(true);
      expect(result.messages).toEqual([prompt]);
      expect(result.unknownFlags.size).toBe(0);
    });

    test("does not consume options after -p as prompts", () => {
      const result = parseArgs(["-p", "--provider", "openai", "Say hi."]);
      expect(result.print).toBe(true);
      expect(result.provider).toBe("openai");
      expect(result.messages).toEqual(["Say hi."]);
    });
  });
  describe("--continue flag", () => {
    test("parses --continue flag", () => {
      const result = parseArgs(["--continue"]);
      expect(result.continue).toBe(true);
    });

    test("parses -c shorthand", () => {
      const result = parseArgs(["-c"]);
      expect(result.continue).toBe(true);
    });
  });
  describe("--resume flag", () => {
    test("parses --resume flag", () => {
      const result = parseArgs(["--resume"]);
      expect(result.resume).toBe(true);
    });

    test("parses -r shorthand", () => {
      const result = parseArgs(["-r"]);
      expect(result.resume).toBe(true);
    });
  });
  describe("flags with values", () => {
    test("parses --provider", () => {
      const result = parseArgs(["--provider", "openai"]);
      expect(result.provider).toBe("openai");
    });

    test("parses --model", () => {
      const result = parseArgs(["--model", "gpt-4o"]);
      expect(result.model).toBe("gpt-4o");
    });

    test("parses --api-key", () => {
      const result = parseArgs(["--api-key", "sk-test-key"]);
      expect(result.apiKey).toBe("sk-test-key");
    });

    test("parses --system-prompt", () => {
      const result = parseArgs(["--system-prompt", "You are a helpful assistant"]);
      expect(result.systemPrompt).toBe("You are a helpful assistant");
    });

    test("parses --append-system-prompt", () => {
      const result = parseArgs(["--append-system-prompt", "Additional context"]);
      expect(result.appendSystemPrompt).toEqual(["Additional context"]);
    });

    test("parses multiple --append-system-prompt flags", () => {
      const result = parseArgs([
        "--append-system-prompt",
        "Context A",
        "--append-system-prompt",
        "Context B",
      ]);
      expect(result.appendSystemPrompt).toEqual(["Context A", "Context B"]);
    });

    test("parses --session", () => {
      const result = parseArgs(["--session", "/path/to/session.jsonl"]);
      expect(result.session).toBe("/path/to/session.jsonl");
    });

    test("parses --session-id", () => {
      const result = parseArgs(["--session-id", "orchestrated-session"]);
      expect(result.sessionId).toBe("orchestrated-session");
    });

    test("parses --fork", () => {
      const result = parseArgs(["--fork", "1234abcd"]);
      expect(result.fork).toBe("1234abcd");
      expect(result.messages).toEqual([]);
    });

    test("parses --export", () => {
      const result = parseArgs(["--export", "session.jsonl"]);
      expect(result.export).toBe("session.jsonl");
    });

    test("parses --thinking", () => {
      const result = parseArgs(["--thinking", "high"]);
      expect(result.thinking).toBe("high");
    });

    test("parses --models as comma-separated list", () => {
      const result = parseArgs(["--models", "gpt-4o,claude-sonnet,gemini-pro"]);
      expect(result.models).toEqual(["gpt-4o", "claude-sonnet", "gemini-pro"]);
    });

    test("ignores empty entries in --models", () => {
      const result = parseArgs(["--models", "gpt-4o, ,claude-sonnet,"]);
      expect(result.models).toEqual(["gpt-4o", "claude-sonnet"]);
    });
  });
  describe("--mode flag", () => {
    test.each(["text", "json", "rpc"] as const)("parses --mode %s", (mode) => {
      const result = parseArgs(["--mode", mode]);
      expect(result.mode).toBe(mode);
      expect(result.diagnostics).toEqual([]);
    });

    test.each(["yaml", ""])("rejects invalid --mode value %j", (mode) => {
      const result = parseArgs(["--mode", mode, "--version"]);
      expect(result.mode).toBeUndefined();
      expect(result.version).toBe(true);
      expect(result.messages).toEqual([]);
      expect(result.unknownFlags.size).toBe(0);
      expect(result.diagnostics).toEqual([
        {
          type: "error" as const,
          message: `Invalid mode "${mode}". Valid values: text, json, rpc`,
        },
      ]);
    });

    test("reports a missing --mode value", () => {
      const result = parseArgs(["--mode"]);
      expect(result.mode).toBeUndefined();
      expect(result.unknownFlags.size).toBe(0);
      expect(result.diagnostics).toEqual([
        { type: "error" as const, message: "--mode requires text, json, or rpc" },
      ]);
    });

    test("does not consume another option as a --mode value", () => {
      const result = parseArgs(["--mode", "--version"]);
      expect(result.mode).toBeUndefined();
      expect(result.version).toBe(true);
      expect(result.unknownFlags.size).toBe(0);
      expect(result.diagnostics).toEqual([
        { type: "error" as const, message: "--mode requires text, json, or rpc" },
      ]);
    });

    test("reports an invalid --mode value after a valid one", () => {
      const result = parseArgs(["--mode", "json", "--mode", "yaml"]);
      expect(result.diagnostics).toEqual([
        { type: "error" as const, message: 'Invalid mode "yaml". Valid values: text, json, rpc' },
      ]);
    });
  });
  describe("--name flag", () => {
    test("parses --name flag with value", () => {
      const result = parseArgs(["--name", "my-session"]);
      expect(result.name).toBe("my-session");
    });

    test("parses -n shorthand", () => {
      const result = parseArgs(["-n", "quick-session"]);
      expect(result.name).toBe("quick-session");
    });

    test("preserves empty values for main validation", () => {
      const result = parseArgs(["--name", ""]);
      expect(result.name).toBe("");
    });

    test("normalizes display names and rejects whitespace-only values", () => {
      expect(normalizeSessionName("  named session  ")).toBe("named session");
      expect(normalizeSessionName("   ")).toBeUndefined();
    });

    test("reports missing value", () => {
      const result = parseArgs(["--name"]);
      expect(result.diagnostics).toEqual([
        { type: "error" as const, message: "--name requires a value" },
      ]);
    });

    test("works alongside other flags", () => {
      const result = parseArgs(["--name", "named-run", "--print", "--model", "gpt-4o", "hello"]);
      expect(result.name).toBe("named-run");
      expect(result.print).toBe(true);
      expect(result.model).toBe("gpt-4o");
      expect(result.messages).toEqual(["hello"]);
    });
  });
});
