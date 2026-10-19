import { describe, expect, test } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
  describe("--no-session flag", () => {
    test("parses --no-session flag", () => {
      const result = parseArgs(["--no-session"]);
      expect(result.noSession).toBe(true);
    });

    test("preserves custom session IDs for non-persisting commands", () => {
      expect(parseArgs(["--session-id", "ephemeral-id", "--help"])).toMatchObject({
        sessionId: "ephemeral-id",
        help: true,
      });
      expect(parseArgs(["--session-id", "ephemeral-id", "--list-models"])).toMatchObject({
        sessionId: "ephemeral-id",
        listModels: true,
      });
      expect(parseArgs(["--session-id", "ephemeral-id", "--no-session"])).toMatchObject({
        sessionId: "ephemeral-id",
        noSession: true,
      });
    });
  });
  describe("--extension flag", () => {
    test("parses single --extension", () => {
      const result = parseArgs(["--extension", "./my-extension.ts"]);
      expect(result.extensions).toEqual(["./my-extension.ts"]);
    });

    test("parses -e shorthand", () => {
      const result = parseArgs(["-e", "./my-extension.ts"]);
      expect(result.extensions).toEqual(["./my-extension.ts"]);
    });

    test("parses multiple --extension flags", () => {
      const result = parseArgs(["--extension", "./ext1.ts", "-e", "./ext2.ts"]);
      expect(result.extensions).toEqual(["./ext1.ts", "./ext2.ts"]);
    });
  });
  describe("--no-extensions flag", () => {
    test("parses --no-extensions flag", () => {
      const result = parseArgs(["--no-extensions"]);
      expect(result.noExtensions).toBe(true);
    });

    test("parses --no-extensions with explicit -e flags", () => {
      const result = parseArgs(["--no-extensions", "-e", "foo.ts", "-e", "bar.ts"]);
      expect(result.noExtensions).toBe(true);
      expect(result.extensions).toEqual(["foo.ts", "bar.ts"]);
    });
  });
  describe("--no-mcp flag", () => {
    test("parses --no-mcp flag", () => {
      const result = parseArgs(["--no-mcp"]);
      expect(result.noMcp).toBe(true);
      expect(result.unknownFlags.size).toBe(0);
    });
  });
  describe("--skill flag", () => {
    test("parses single --skill", () => {
      const result = parseArgs(["--skill", "./skill-dir"]);
      expect(result.skills).toEqual(["./skill-dir"]);
    });

    test("parses multiple --skill flags", () => {
      const result = parseArgs(["--skill", "./skill-a", "--skill", "./skill-b"]);
      expect(result.skills).toEqual(["./skill-a", "./skill-b"]);
    });
  });
  describe("--prompt-template flag", () => {
    test("parses single --prompt-template", () => {
      const result = parseArgs(["--prompt-template", "./prompts"]);
      expect(result.promptTemplates).toEqual(["./prompts"]);
    });

    test("parses multiple --prompt-template flags", () => {
      const result = parseArgs(["--prompt-template", "./one", "--prompt-template", "./two"]);
      expect(result.promptTemplates).toEqual(["./one", "./two"]);
    });
  });
  describe("--theme flag", () => {
    test("parses single --theme", () => {
      const result = parseArgs(["--theme", "./theme.json"]);
      expect(result.themes).toEqual(["./theme.json"]);
    });

    test("parses multiple --theme flags", () => {
      const result = parseArgs(["--theme", "./dark.json", "--theme", "./light.json"]);
      expect(result.themes).toEqual(["./dark.json", "./light.json"]);
    });
  });
  describe("--use-theme flag", () => {
    test("parses --use-theme", () => {
      const result = parseArgs(["--use-theme", "light"]);
      expect(result.useTheme).toBe("light");
    });

    test("reports when the theme name value is missing", () => {
      const result = parseArgs(["--use-theme", "--print"]);
      expect(result.useTheme).toBeUndefined();
      expect(result.print).toBe(true);
      expect(result.diagnostics).toEqual([
        { type: "error" as const, message: "--use-theme requires a theme name" },
      ]);
    });
  });
  describe("--no-skills flag", () => {
    test("parses --no-skills flag", () => {
      const result = parseArgs(["--no-skills"]);
      expect(result.noSkills).toBe(true);
    });
  });
  describe("--no-prompt-templates flag", () => {
    test("parses --no-prompt-templates flag", () => {
      const result = parseArgs(["--no-prompt-templates"]);
      expect(result.noPromptTemplates).toBe(true);
    });
  });
  describe("--no-themes flag", () => {
    test("parses --no-themes flag", () => {
      const result = parseArgs(["--no-themes"]);
      expect(result.noThemes).toBe(true);
    });
  });
  describe("--no-context-files flag", () => {
    test("parses --no-context-files flag", () => {
      const result = parseArgs(["--no-context-files"]);
      expect(result.noContextFiles).toBe(true);
    });

    test("parses -nc shorthand", () => {
      const result = parseArgs(["-nc"]);
      expect(result.noContextFiles).toBe(true);
    });
  });
  describe("project approval flags", () => {
    test("parses --approve", () => {
      const result = parseArgs(["--approve"]);
      expect(result.projectTrustOverride).toBe(true);
    });

    test("parses -a shorthand", () => {
      const result = parseArgs(["-a"]);
      expect(result.projectTrustOverride).toBe(true);
    });

    test("parses --no-approve", () => {
      const result = parseArgs(["--no-approve"]);
      expect(result.projectTrustOverride).toBe(false);
    });

    test("parses -na shorthand", () => {
      const result = parseArgs(["-na"]);
      expect(result.projectTrustOverride).toBe(false);
    });
  });
  describe("--verbose flag", () => {
    test("parses --verbose flag", () => {
      const result = parseArgs(["--verbose"]);
      expect(result.verbose).toBe(true);
    });
  });
  describe("--offline flag", () => {
    test("parses --offline flag", () => {
      const result = parseArgs(["--offline"]);
      expect(result.offline).toBe(true);
    });
  });
  describe("--tui-mode flag", () => {
    test.each(["regular", "fullscreen"] as const)("parses %s mode", (mode) => {
      const result = parseArgs(["--tui-mode", mode]);
      expect(result.tuiMode).toBe(mode);
    });

    test("rejects invalid modes", () => {
      const result = parseArgs(["--tui-mode", "other"]);
      expect(result.diagnostics).toEqual([
        {
          type: "error" as const,
          message: 'Invalid TUI mode "other". Valid values: regular, fullscreen',
        },
      ]);
    });

    test("requires a mode", () => {
      const result = parseArgs(["--tui-mode"]);
      expect(result.diagnostics).toEqual([
        { type: "error" as const, message: "--tui-mode requires regular or fullscreen" },
      ]);
    });

    test("does not recognize the old --ui-mode flag", () => {
      const result = parseArgs(["--ui-mode", "fullscreen"]);
      expect(result.tuiMode).toBeUndefined();
      expect(result.unknownFlags.get("ui-mode")).toBe("fullscreen");
    });
  });
});
