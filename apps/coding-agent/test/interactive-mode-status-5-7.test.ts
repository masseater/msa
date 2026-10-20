import { homedir } from "node:os";

import testing from "@msa/testing";
import { beforeAll, describe, expect, test } from "vite-plus/test";

import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getStartupVisibility } from "../src/modes/interactive/loaded-resources.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import interactiveModeStatus5Support from "./interactive-mode-status-5-support.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";

const { createShowLoadedResourcesThis } = interactiveModeStatus5Support;

const { renderAll } = interactiveModeStatusSupport;

const { joinPath } = testing;

const showsContextPathsRelativeToCwdWhile = () => {
  const home = homedir();
  const cwd = joinPath(home, "Development", "msa-mono");
  const fakeThis = createShowLoadedResourcesThis({
    contextFiles: [
      { path: joinPath(home, ".msa", "agent", "AGENTS.md") },
      { path: joinPath(cwd, "AGENTS.md") },
    ],
    cwd,
    quietStartup: false,
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer).replace(/\\/gu, "/");
  expect(output).toContain("[Context]");
  expect(output).toContain("~/.msa/agent/AGENTS.md, AGENTS.md");
  expect(output).not.toContain(`${cwd.replace(/\\/gu, "/")}/AGENTS.md`);
};

const showsSystemPromptContextPathsBeforeProject = () => {
  const cwd = "/tmp/project";
  const fakeThis = createShowLoadedResourcesThis({
    appendSystemPromptSources: [{ path: joinPath(cwd, ".msa", "APPEND_SYSTEM.md") }],
    contextFiles: [{ path: joinPath(cwd, "AGENTS.md") }],
    cwd,
    quietStartup: false,
    systemPromptSource: { path: joinPath(cwd, ".msa", "SYSTEM.md") },
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer).replace(/\\/gu, "/");
  expect(output).toContain("[Context]");
  expect(output).toContain(".msa/SYSTEM.md, .msa/APPEND_SYSTEM.md, AGENTS.md");
};

const showsFullContextPathsWhenExpanded = () => {
  const home = homedir();
  const cwd = joinPath(home, "Development", "msa-mono");
  const fakeThis = createShowLoadedResourcesThis({
    contextFiles: [
      { path: joinPath(home, ".msa", "agent", "AGENTS.md") },
      { path: joinPath(cwd, "AGENTS.md") },
    ],
    cwd,
    quietStartup: false,
    toolOutputExpanded: true,
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer).replace(/\\/gu, "/");
  expect(output).toContain("[Context]");
  expect(output).toContain("~/.msa/agent/AGENTS.md");
  expect(output).toContain("~/Development/msa-mono/AGENTS.md");
  expect(output).not.toContain("~/.msa/agent/AGENTS.md, AGENTS.md");
};

const doesNotShowVerboseListingOnQuiet = () => {
  const fakeThis = createShowLoadedResourcesThis({
    quietStartup: true,
    skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    extensions: [{ path: "/tmp/ext/index.ts" }],
    force: false,
    showDiagnosticsWhenQuiet: true,
  });

  expect(fakeThis.loadedResourcesContainer.children).toHaveLength(0);
};

const hidesResourceListingButKeepsTheStartup = () => {
  const fakeThis = createShowLoadedResourcesThis({
    quietStartup: "header",
    skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  expect(fakeThis.loadedResourcesContainer.children).toHaveLength(0);
  expect(getStartupVisibility("header", false)).toEqual({ details: false, header: true });
};

const hidesTheStartupHeaderWithFullQuiet = () => {
  expect(getStartupVisibility(true, false)).toEqual({ details: false, header: false });
  expect(getStartupVisibility("header", true)).toEqual({ details: true, header: true });
};

const stillShowsDiagnosticsOnQuietStartupWhen = () => {
  const fakeThis = createShowLoadedResourcesThis({
    quietStartup: true,
    skillDiagnostics: [{ message: "duplicate skill name", type: "warning" as const }],
    skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
    showDiagnosticsWhenQuiet: true,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer);
  expect(output).toContain("[Skill conflicts]");
  expect(output).not.toContain("[Skills]");
};

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "shows context paths relative to cwd while preserving full external paths",
    showsContextPathsRelativeToCwdWhile,
  );
});

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "shows system prompt context paths before project context files",
    showsSystemPromptContextPathsBeforeProject,
  );

  test("shows full context paths when expanded", showsFullContextPathsWhenExpanded);

  test(
    "does not show verbose listing on quiet startup during reload",
    doesNotShowVerboseListingOnQuiet,
  );
});

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "hides resource listing but keeps the startup header with header-only quiet startup",
    hidesResourceListingButKeepsTheStartup,
  );

  test(
    "hides the startup header with full quiet startup unless verbose",
    hidesTheStartupHeaderWithFullQuiet,
  );
});

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "still shows diagnostics on quiet startup when requested",
    stillShowsDiagnosticsOnQuietStartupWhen,
  );
});
