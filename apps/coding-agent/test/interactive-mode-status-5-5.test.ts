import { beforeAll, describe, expect, test } from "vite-plus/test";

import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import interactiveModeStatus5Support from "./interactive-mode-status-5-support.ts";
import type interactiveModeStatus5SupportTypes from "./interactive-mode-status-5-support.types.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";

const { bindModeFake } = interactiveModeFake;
const { initTheme } = themeModule;

const { createShowLoadedResourcesThis, createSourceInfo } = interactiveModeStatus5Support;

const { normalizeRenderedOutput } = interactiveModeStatusSupport;

const packageExtensionsStillStripIndexTsCorrectly = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/project/.msa/npm/node_modules/msa-markdown-preview/extensions/index.ts",
      sourceInfo: createSourceInfo(
        "/tmp/project/.msa/npm/node_modules/msa-markdown-preview/extensions/index.ts",
        {
          baseDir: "/tmp/project/.msa/npm/node_modules/msa-markdown-preview",
          origin: "package",
          scope: "project",
          source: "npm:msa-markdown-preview",
        },
      ),
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
  msa-markdown-preview"`);
};

const labelsNpmSiblingExtensionsRelativeToThe = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/project/.msa/npm/node_modules/primary-package/index.ts",
      sourceInfo: createSourceInfo("/tmp/project/.msa/npm/node_modules/primary-package/index.ts", {
        baseDir: "/tmp/project/.msa/npm/node_modules/primary-package",
        origin: "package",
        scope: "project",
        source: "npm:primary-package",
      }),
    },
    {
      path: "/tmp/project/.msa/npm/node_modules/sibling-package/index.ts",
      sourceInfo: createSourceInfo("/tmp/project/.msa/npm/node_modules/sibling-package/index.ts", {
        baseDir: "/tmp/project/.msa/npm/node_modules/primary-package",
        origin: "package",
        scope: "project",
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

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "package extensions still strip index.ts correctly (regression guard)",
    packageExtensionsStillStripIndexTsCorrectly,
  );

  test(
    "labels npm sibling extensions relative to the declaring package",
    labelsNpmSiblingExtensionsRelativeToThe,
  );
});
