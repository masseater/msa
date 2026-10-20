import { describe, expect, it } from "vite-plus/test";

import utils from "../examples/extensions/plan-mode/utils.ts";

const { cleanStepText, extractTodoItems, isSafeCommand } = utils;

const allowsBasicReadCommands = () => {
  expect(isSafeCommand("ls -la")).toBe(true);
  expect(isSafeCommand("cat file.txt")).toBe(true);
  expect(isSafeCommand("head -n 10 file.txt")).toBe(true);
  expect(isSafeCommand("tail -f log.txt")).toBe(true);
  expect(isSafeCommand("grep pattern file")).toBe(true);
  expect(isSafeCommand("find . -name '*.ts'")).toBe(true);
};

const allowsGitReadCommands = () => {
  expect(isSafeCommand("git status")).toBe(true);
  expect(isSafeCommand("git log --oneline")).toBe(true);
  expect(isSafeCommand("git diff")).toBe(true);
  expect(isSafeCommand("git branch")).toBe(true);
};

const allowsNpmYarnReadCommands = () => {
  expect(isSafeCommand("npm list")).toBe(true);
  expect(isSafeCommand("npm outdated")).toBe(true);
  expect(isSafeCommand("yarn info react")).toBe(true);
};

const allowsOtherSafeCommands = () => {
  expect(isSafeCommand("pwd")).toBe(true);
  expect(isSafeCommand("echo hello")).toBe(true);
  expect(isSafeCommand("wc -l file.txt")).toBe(true);
  expect(isSafeCommand("du -sh .")).toBe(true);
  expect(isSafeCommand("df -h")).toBe(true);
};

const blocksFileModificationCommands = () => {
  expect(isSafeCommand("rm file.txt")).toBe(false);
  expect(isSafeCommand("rm -rf dir")).toBe(false);
  expect(isSafeCommand("mv old new")).toBe(false);
  expect(isSafeCommand("cp src dst")).toBe(false);
  expect(isSafeCommand("mkdir newdir")).toBe(false);
  expect(isSafeCommand("touch newfile")).toBe(false);
};

const blocksGitWriteCommands = () => {
  expect(isSafeCommand("git add .")).toBe(false);
  expect(isSafeCommand("git commit -m 'msg'")).toBe(false);
  expect(isSafeCommand("git push")).toBe(false);
  expect(isSafeCommand("git checkout main")).toBe(false);
  expect(isSafeCommand("git reset --hard")).toBe(false);
};

const blocksPackageManagerInstalls = () => {
  expect(isSafeCommand("npm install lodash")).toBe(false);
  expect(isSafeCommand("yarn add react")).toBe(false);
  expect(isSafeCommand("pip install requests")).toBe(false);
  expect(isSafeCommand("brew install node")).toBe(false);
};

const blocksRedirects = () => {
  expect(isSafeCommand("echo hello > file.txt")).toBe(false);
  expect(isSafeCommand("cat foo >> bar")).toBe(false);
  expect(isSafeCommand(">file.txt")).toBe(false);
};

const blocksDangerousCommands = () => {
  expect(isSafeCommand("sudo rm -rf /")).toBe(false);
  expect(isSafeCommand("kill -9 1234")).toBe(false);
  expect(isSafeCommand("reboot")).toBe(false);
};

const blocksEditors = () => {
  expect(isSafeCommand("vim file.txt")).toBe(false);
  expect(isSafeCommand("nano file.txt")).toBe(false);
  expect(isSafeCommand("code .")).toBe(false);
};

const requiresCommandToBeInSafeList = () => {
  expect(isSafeCommand("unknown-command")).toBe(false);
  expect(isSafeCommand("my-script.sh")).toBe(false);
};

const handlesCommandsWithLeadingWhitespace = () => {
  expect(isSafeCommand("  ls -la")).toBe(true);
  expect(isSafeCommand("  rm file")).toBe(false);
};

describe("isSafeCommand", () => {
  describe("safe commands", () => {
    it("allows basic read commands", allowsBasicReadCommands);

    it("allows git read commands", allowsGitReadCommands);

    it("allows npm/yarn read commands", allowsNpmYarnReadCommands);

    it("allows other safe commands", allowsOtherSafeCommands);
  });

  describe("destructive commands", () => {
    it("blocks file modification commands", blocksFileModificationCommands);

    it("blocks git write commands", blocksGitWriteCommands);

    it("blocks package manager installs", blocksPackageManagerInstalls);

    it("blocks redirects", blocksRedirects);

    it("blocks dangerous commands", blocksDangerousCommands);

    it("blocks editors", blocksEditors);
  });

  describe("edge cases", () => {
    it(
      "requires command to be in safe list (not just non-destructive)",
      requiresCommandToBeInSafeList,
    );

    it("handles commands with leading whitespace", handlesCommandsWithLeadingWhitespace);
  });
});

const removesMarkdownBoldItalic = () => {
  expect(cleanStepText("**bold text**")).toBe("Bold text");
  expect(cleanStepText("*italic text*")).toBe("Italic text");
};

const removesMarkdownCode = () => {
  expect(cleanStepText("run `npm install`")).toBe("Npm install");
  expect(cleanStepText("check the `config.json` file")).toBe("Config.json file");
};

const removesLeadingActionWords = () => {
  expect(cleanStepText("Create the new file")).toBe("New file");
  expect(cleanStepText("Run the tests")).toBe("Tests");
  expect(cleanStepText("Check the status")).toBe("Status");
};

const capitalizesFirstLetter = () => {
  expect(cleanStepText("update config")).toBe("Config");
};

const truncatesLongText = () => {
  const longText =
    "This is a very long step description that exceeds the maximum allowed length for display";
  const result = cleanStepText(longText);
  expect(result.length).toBe(50);
  expect(result.endsWith("...")).toBe(true);
};

const normalizesWhitespace = () => {
  expect(cleanStepText("multiple   spaces   here")).toBe("Multiple spaces here");
};

describe("cleanStepText", () => {
  it("removes markdown bold/italic", removesMarkdownBoldItalic);

  it("removes markdown code", removesMarkdownCode);

  it("removes leading action words", removesLeadingActionWords);

  it("capitalizes first letter", capitalizesFirstLetter);

  it("truncates long text", truncatesLongText);

  it("normalizes whitespace", normalizesWhitespace);
});

const extractsNumberedItemsAfterPlanHeader = () => {
  const message = `Here's what we'll do:

Plan:
1. First step here
2. Second step here
3. Third step here`;

  const items = extractTodoItems(message);
  expect(items).toHaveLength(3);
  expect(items[0]?.step).toBe(1);
  expect(items[0]?.text).toBe("First step here");
  expect(items[0]?.completed).toBe(false);
};

const handlesBoldPlanHeader = () => {
  const message = `**Plan:**
1. Do something`;

  const items = extractTodoItems(message);
  expect(items).toHaveLength(1);
};

const handlesParenthesisStyleNumbering = () => {
  const message = `Plan:
1) First item
2) Second item`;

  const items = extractTodoItems(message);
  expect(items).toHaveLength(2);
};

const returnsEmptyArrayWithoutPlanHeader = () => {
  const message = `Here are some steps:
1. First step
2. Second step`;

  const items = extractTodoItems(message);
  expect(items).toHaveLength(0);
};

const filtersOutShortItems = () => {
  const message = `Plan:
1. OK
2. This is a proper step`;

  const items = extractTodoItems(message);
  expect(items).toHaveLength(1);
  expect(items[0]?.text).toContain("proper");
};

const filtersOutCodeLikeItems = () => {
  const message = `Plan:
1. \`npm install\`
2. Run the build process`;

  const items = extractTodoItems(message);
  expect(items).toHaveLength(1);
};

describe("extractTodoItems", () => {
  it("extracts numbered items after Plan: header", extractsNumberedItemsAfterPlanHeader);

  it("handles bold Plan header", handlesBoldPlanHeader);

  it("handles parenthesis-style numbering", handlesParenthesisStyleNumbering);

  it("returns empty array without Plan header", returnsEmptyArrayWithoutPlanHeader);

  it("filters out short items", filtersOutShortItems);

  it("filters out code-like items", filtersOutCodeLikeItems);
});
