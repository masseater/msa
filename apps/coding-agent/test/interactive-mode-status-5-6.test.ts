import { beforeAll, describe, expect, test } from "vite-plus/test";

import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import interactiveModeStatus5Support from "./interactive-mode-status-5-support.ts";
import type interactiveModeStatus5SupportTypes from "./interactive-mode-status-5-support.types.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";

const { bindModeFake } = interactiveModeFake;
const { initTheme } = themeModule;

const { createExtensionFixtures, createShowLoadedResourcesThis, createSourceInfo } =
  interactiveModeStatus5Support;

const { normalizeRenderedOutput } = interactiveModeStatusSupport;

const labelsWindowsNpmSiblingExtensionsRelativeTo = () => {
  const primaryPath = "C:\\Users\\me\\.msa\\agent\\npm\\node_modules\\primary-package\\index.ts";
  const siblingPath = "C:\\Users\\me\\.msa\\agent\\npm\\node_modules\\sibling-package\\index.ts";
  const baseDir = "C:\\Users\\me\\.msa\\agent\\npm\\node_modules\\primary-package";
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: primaryPath,
      sourceInfo: createSourceInfo(primaryPath, {
        baseDir,
        origin: "package",
        scope: "user",
        source: "npm:primary-package",
      }),
    },
    {
      path: siblingPath,
      sourceInfo: createSourceInfo(siblingPath, {
        baseDir,
        origin: "package",
        scope: "user",
        source: "npm:primary-package",
      }),
    },
  ];

  const fakeThis = createShowLoadedResourcesThis({
    extensions,
    quietStartup: false,
  });

  bindModeFake(fakeThis).display.resources.showLoadedResources({
    force: false,
  });

  expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  primary-package, primary-package:../sibling-package"`);
};

const capturesMixedExtensionLayoutsInExpandedOutput = () => {
  const fakeThis = createShowLoadedResourcesThis({
    extensions: createExtensionFixtures(),
    quietStartup: false,
    toolOutputExpanded: true,
  });

  bindModeFake(fakeThis).display.resources.showLoadedResources({
    force: false,
  });

  expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  project
    /tmp/project/.msa/extensions/answer.ts
    /tmp/project/.msa/extensions/local-index
    git:github.com/HazAT/pi-interactive-subagents
      extensions
      extensions/subagents
    npm:@scope/msa-scoped
      extensions
    npm:msa-markdown-preview
      extensions
  user
    /tmp/agent/extensions/user-index
  path
    /tmp/temp/cli-extension.ts"`);
};

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "labels Windows npm sibling extensions relative to the declaring package",
    labelsWindowsNpmSiblingExtensionsRelativeTo,
  );

  test(
    "captures mixed extension layouts in expanded output",
    capturesMixedExtensionLayoutsInExpandedOutput,
  );
});
