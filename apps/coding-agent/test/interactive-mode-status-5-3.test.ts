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

const stripsIndexTsFromLocalExtensionLabel = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/extensions/plan-mode/index.ts",
      sourceInfo: createSourceInfo("/tmp/extensions/plan-mode/index.ts", {
        baseDir: "/tmp/extensions",
        origin: "top-level",
        scope: "project",
        source: "local",
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
  plan-mode"`);
};

const stripsIndexJsFromLocalExtensionLabel = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/extensions/plan-mode/index.js",
      sourceInfo: createSourceInfo("/tmp/extensions/plan-mode/index.js", {
        baseDir: "/tmp/extensions",
        origin: "top-level",
        scope: "project",
        source: "local",
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
  plan-mode"`);
};

const mixedSingleFileAndSubdirectoryIndexTs = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/extensions/webfetch.ts",
      sourceInfo: createSourceInfo("/tmp/extensions/webfetch.ts", {
        baseDir: "/tmp/extensions",
        origin: "top-level",
        scope: "project",
        source: "local",
      }),
    },
    {
      path: "/tmp/extensions/plan-mode/index.ts",
      sourceInfo: createSourceInfo("/tmp/extensions/plan-mode/index.ts", {
        baseDir: "/tmp/extensions",
        origin: "top-level",
        scope: "project",
        source: "local",
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
  plan-mode, webfetch.ts"`);
};

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "strips index.ts from local extension label, showing parent dir",
    stripsIndexTsFromLocalExtensionLabel,
  );

  test(
    "strips index.js from local extension label, showing parent dir",
    stripsIndexJsFromLocalExtensionLabel,
  );
});

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "mixed single-file and subdirectory index.ts extensions strip index.ts",
    mixedSingleFileAndSubdirectoryIndexTs,
  );
});
