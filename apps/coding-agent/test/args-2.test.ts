import { describe, expect, test } from "vite-plus/test";

import args from "../src/cli/args.ts";

const { parseArgs } = args;

const parsesNoSessionFlag = () => {
  const result = parseArgs(["--no-session"]);
  expect(result.noSession).toBe(true);
};

const preservesCustomSessionIdsForNonPersisting = () => {
  expect(parseArgs(["--session-id", "ephemeral-id", "--help"])).toMatchObject({
    help: true,
    sessionId: "ephemeral-id",
  });
  expect(parseArgs(["--session-id", "ephemeral-id", "--list-models"])).toMatchObject({
    listModels: true,
    sessionId: "ephemeral-id",
  });
  expect(parseArgs(["--session-id", "ephemeral-id", "--no-session"])).toMatchObject({
    noSession: true,
    sessionId: "ephemeral-id",
  });
};

const parsesSingleExtension = () => {
  const result = parseArgs(["--extension", "./my-extension.ts"]);
  expect(result.extensions).toEqual(["./my-extension.ts"]);
};

const parsesEShorthand = () => {
  const result = parseArgs(["-e", "./my-extension.ts"]);
  expect(result.extensions).toEqual(["./my-extension.ts"]);
};

const parsesMultipleExtensionFlags = () => {
  const result = parseArgs(["--extension", "./ext1.ts", "-e", "./ext2.ts"]);
  expect(result.extensions).toEqual(["./ext1.ts", "./ext2.ts"]);
};

const parsesNoExtensionsFlag = () => {
  const result = parseArgs(["--no-extensions"]);
  expect(result.noExtensions).toBe(true);
};

const parsesNoExtensionsWithExplicitEFlags = () => {
  const result = parseArgs(["--no-extensions", "-e", "foo.ts", "-e", "bar.ts"]);
  expect(result.noExtensions).toBe(true);
  expect(result.extensions).toEqual(["foo.ts", "bar.ts"]);
};

const parsesNoMcpFlag = () => {
  const result = parseArgs(["--no-mcp"]);
  expect(result.noMcp).toBe(true);
  expect(result.unknownFlags.size).toBe(0);
};

const parsesSingleSkill = () => {
  const result = parseArgs(["--skill", "./skill-dir"]);
  expect(result.skills).toEqual(["./skill-dir"]);
};

const parsesMultipleSkillFlags = () => {
  const result = parseArgs(["--skill", "./skill-a", "--skill", "./skill-b"]);
  expect(result.skills).toEqual(["./skill-a", "./skill-b"]);
};

const parsesSinglePromptTemplate = () => {
  const result = parseArgs(["--prompt-template", "./prompts"]);
  expect(result.promptTemplates).toEqual(["./prompts"]);
};

const parsesMultiplePromptTemplateFlags = () => {
  const result = parseArgs(["--prompt-template", "./one", "--prompt-template", "./two"]);
  expect(result.promptTemplates).toEqual(["./one", "./two"]);
};

const parsesSingleTheme = () => {
  const result = parseArgs(["--theme", "./theme.json"]);
  expect(result.themes).toEqual(["./theme.json"]);
};

const parsesMultipleThemeFlags = () => {
  const result = parseArgs(["--theme", "./dark.json", "--theme", "./light.json"]);
  expect(result.themes).toEqual(["./dark.json", "./light.json"]);
};

const parsesUseTheme = () => {
  const result = parseArgs(["--use-theme", "light"]);
  expect(result.useTheme).toBe("light");
};

const reportsWhenTheThemeNameValueIs = () => {
  const result = parseArgs(["--use-theme", "--print"]);
  expect(result.useTheme).toBeUndefined();
  expect(result.print).toBe(true);
  expect(result.diagnostics).toEqual([
    { message: "--use-theme requires a theme name", type: "error" as const },
  ]);
};

const parsesNoSkillsFlag = () => {
  const result = parseArgs(["--no-skills"]);
  expect(result.noSkills).toBe(true);
};

const parsesNoPromptTemplatesFlag = () => {
  const result = parseArgs(["--no-prompt-templates"]);
  expect(result.noPromptTemplates).toBe(true);
};

const parsesNoThemesFlag = () => {
  const result = parseArgs(["--no-themes"]);
  expect(result.noThemes).toBe(true);
};

const parsesNoContextFilesFlag = () => {
  const result = parseArgs(["--no-context-files"]);
  expect(result.noContextFiles).toBe(true);
};

const parsesNcShorthand = () => {
  const result = parseArgs(["-nc"]);
  expect(result.noContextFiles).toBe(true);
};

const parsesApprove = () => {
  const result = parseArgs(["--approve"]);
  expect(result.projectTrustOverride).toBe(true);
};

const parsesAShorthand = () => {
  const result = parseArgs(["-a"]);
  expect(result.projectTrustOverride).toBe(true);
};

const parsesNoApprove = () => {
  const result = parseArgs(["--no-approve"]);
  expect(result.projectTrustOverride).toBe(false);
};

const parsesNaShorthand = () => {
  const result = parseArgs(["-na"]);
  expect(result.projectTrustOverride).toBe(false);
};

const parsesVerboseFlag = () => {
  const result = parseArgs(["--verbose"]);
  expect(result.verbose).toBe(true);
};

const parsesOfflineFlag = () => {
  const result = parseArgs(["--offline"]);
  expect(result.offline).toBe(true);
};

const rejectsInvalidModes = () => {
  const result = parseArgs(["--tui-mode", "other"]);
  expect(result.diagnostics).toEqual([
    {
      message: 'Invalid TUI mode "other". Valid values: regular, fullscreen',
      type: "error" as const,
    },
  ]);
};

const requiresAMode = () => {
  const result = parseArgs(["--tui-mode"]);
  expect(result.diagnostics).toEqual([
    { message: "--tui-mode requires regular or fullscreen", type: "error" as const },
  ]);
};

const doesNotRecognizeTheOldUiMode = () => {
  const result = parseArgs(["--ui-mode", "fullscreen"]);
  expect(result.tuiMode).toBeUndefined();
  expect(result.unknownFlags.get("ui-mode")).toBe("fullscreen");
};

describe("parseArgs", () => {
  describe("--no-session flag", () => {
    test("parses --no-session flag", parsesNoSessionFlag);

    test(
      "preserves custom session IDs for non-persisting commands",
      preservesCustomSessionIdsForNonPersisting,
    );
  });

  describe("--extension flag", () => {
    test("parses single --extension", parsesSingleExtension);

    test("parses -e shorthand", parsesEShorthand);

    test("parses multiple --extension flags", parsesMultipleExtensionFlags);
  });

  describe("--no-extensions flag", () => {
    test("parses --no-extensions flag", parsesNoExtensionsFlag);

    test("parses --no-extensions with explicit -e flags", parsesNoExtensionsWithExplicitEFlags);
  });

  describe("--no-mcp flag", () => {
    test("parses --no-mcp flag", parsesNoMcpFlag);
  });

  describe("--skill flag", () => {
    test("parses single --skill", parsesSingleSkill);

    test("parses multiple --skill flags", parsesMultipleSkillFlags);
  });

  describe("--prompt-template flag", () => {
    test("parses single --prompt-template", parsesSinglePromptTemplate);

    test("parses multiple --prompt-template flags", parsesMultiplePromptTemplateFlags);
  });
});

describe("parseArgs", () => {
  describe("--theme flag", () => {
    test("parses single --theme", parsesSingleTheme);

    test("parses multiple --theme flags", parsesMultipleThemeFlags);
  });

  describe("--use-theme flag", () => {
    test("parses --use-theme", parsesUseTheme);

    test("reports when the theme name value is missing", reportsWhenTheThemeNameValueIs);
  });

  describe("--no-skills flag", () => {
    test("parses --no-skills flag", parsesNoSkillsFlag);
  });

  describe("--no-prompt-templates flag", () => {
    test("parses --no-prompt-templates flag", parsesNoPromptTemplatesFlag);
  });

  describe("--no-themes flag", () => {
    test("parses --no-themes flag", parsesNoThemesFlag);
  });

  describe("--no-context-files flag", () => {
    test("parses --no-context-files flag", parsesNoContextFilesFlag);

    test("parses -nc shorthand", parsesNcShorthand);
  });

  describe("project approval flags", () => {
    test("parses --approve", parsesApprove);

    test("parses -a shorthand", parsesAShorthand);

    test("parses --no-approve", parsesNoApprove);

    test("parses -na shorthand", parsesNaShorthand);
  });
});

describe("parseArgs", () => {
  describe("--verbose flag", () => {
    test("parses --verbose flag", parsesVerboseFlag);
  });

  describe("--offline flag", () => {
    test("parses --offline flag", parsesOfflineFlag);
  });

  describe("--tui-mode flag", () => {
    test.each(["regular", "fullscreen"] as const)("parses %s mode", (mode) => {
      const result = parseArgs(["--tui-mode", mode]);
      expect(result.tuiMode).toBe(mode);
    });

    test("rejects invalid modes", rejectsInvalidModes);

    test("requires a mode", requiresAMode);

    test("does not recognize the old --ui-mode flag", doesNotRecognizeTheOldUiMode);
  });
});
