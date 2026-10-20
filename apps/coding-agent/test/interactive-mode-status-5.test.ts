import { beforeAll, describe, expect, test } from "vite-plus/test";

import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import interactiveModeStatus5Support from "./interactive-mode-status-5-support.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";

const { bindModeFake } = interactiveModeFake;
const { initTheme } = themeModule;

const { createShowLoadedResourcesThis } = interactiveModeStatus5Support;

const { renderAll } = interactiveModeStatusSupport;

const showsACompactResourceListingByDefault = () => {
  const fakeThis = createShowLoadedResourcesThis({
    quietStartup: false,
    skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
  });

  bindModeFake(fakeThis).display.resources.showLoadedResources({
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer);
  expect(output).toContain("[Skills]");
  expect(output).toContain("commit");
  expect(output).not.toContain("/tmp/skill/SKILL.md");
};

const showsFullResourceListingWhenExpanded = () => {
  const fakeThis = createShowLoadedResourcesThis({
    quietStartup: false,
    skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
    toolOutputExpanded: true,
  });

  bindModeFake(fakeThis).display.resources.showLoadedResources({
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer);
  expect(output).toContain("[Skills]");
  expect(output).toContain("/tmp/skill/SKILL.md");
  expect(output).not.toContain("  commit");
};

const showsFullResourceListingOnVerboseStartup = () => {
  const fakeThis = createShowLoadedResourcesThis({
    quietStartup: true,
    skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
    toolOutputExpanded: false,
    verbose: true,
  });

  bindModeFake(fakeThis).display.resources.showLoadedResources({
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer);
  expect(output).toContain("[Skills]");
  expect(output).toContain("/tmp/skill/SKILL.md");
  expect(output).not.toContain("  commit");
};

const abbreviatesExtensionsInCompactListing = () => {
  const fakeThis = createShowLoadedResourcesThis({
    extensions: [{ path: "/tmp/extensions/answer.ts" }, { path: "/tmp/extensions/btw.ts" }],
    quietStartup: false,
  });

  bindModeFake(fakeThis).display.resources.showLoadedResources({
    force: false,
  });

  const output = renderAll(fakeThis.loadedResourcesContainer);
  expect(output).toContain("[Extensions]");
  expect(output).toContain("answer.ts, btw.ts");
  expect(output).not.toContain("extensions/answer.ts");
};

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test("shows a compact resource listing by default", showsACompactResourceListingByDefault);

  test("shows full resource listing when expanded", showsFullResourceListingWhenExpanded);

  test(
    "shows full resource listing on verbose startup even when tool output is collapsed",
    showsFullResourceListingOnVerboseStartup,
  );

  test("abbreviates extensions in compact listing", abbreviatesExtensionsInCompactListing);
});
