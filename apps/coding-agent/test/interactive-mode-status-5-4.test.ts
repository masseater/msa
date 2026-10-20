import { beforeAll, describe, expect, test } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeStatus5Support from "./interactive-mode-status-5-support.ts";
import type interactiveModeStatus5SupportTypes from "./interactive-mode-status-5-support.types.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";
const { initTheme } = themeModule;

const { createShowLoadedResourcesThis, createSourceInfo } = interactiveModeStatus5Support;

const { normalizeRenderedOutput } = interactiveModeStatusSupport;

const multipleIndexTsWithUniqueParentDirs = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/extensions/foo/index.ts",
      sourceInfo: createSourceInfo("/tmp/extensions/foo/index.ts", {
        baseDir: "/tmp/extensions",
        origin: "top-level",
        scope: "project",
        source: "local",
      }),
    },
    {
      path: "/tmp/extensions/bar/index.ts",
      sourceInfo: createSourceInfo("/tmp/extensions/bar/index.ts", {
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

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  bar, foo"`);
};

const multipleIndexTsWithSameParentDir = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/alpha/tools/index.ts",
      sourceInfo: createSourceInfo("/tmp/alpha/tools/index.ts", {
        baseDir: "/tmp/alpha",
        origin: "top-level",
        scope: "temporary",
        source: "cli",
      }),
    },
    {
      path: "/tmp/beta/tools/index.ts",
      sourceInfo: createSourceInfo("/tmp/beta/tools/index.ts", {
        baseDir: "/tmp/beta",
        origin: "top-level",
        scope: "temporary",
        source: "cli",
      }),
    },
  ];

  const fakeThis = createShowLoadedResourcesThis({
    extensions,
    quietStartup: false,
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  alpha/tools, beta/tools"`);
};

const nonIndexFileInSubdirectoryStaysAs = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/extensions/my-ext/main.ts",
      sourceInfo: createSourceInfo("/tmp/extensions/my-ext/main.ts", {
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

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  main.ts"`);
};

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "multiple index.ts with unique parent dirs need no disambiguation",
    multipleIndexTsWithUniqueParentDirs,
  );

  test(
    "multiple index.ts with same parent dir name disambiguated with grandparent",
    multipleIndexTsWithSameParentDir,
  );

  test("non-index file in subdirectory stays as filename", nonIndexFileInSubdirectoryStaysAs);
});
