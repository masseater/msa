import { beforeAll, describe, expect, test } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeStatus5Support from "./interactive-mode-status-5-support.ts";
import type interactiveModeStatus5SupportTypes from "./interactive-mode-status-5-support.types.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";
const { initTheme } = themeModule;

const { createExtensionFixtures, createShowLoadedResourcesThis, createSourceInfo } =
  interactiveModeStatus5Support;

const { normalizeRenderedOutput } = interactiveModeStatusSupport;

const capturesMixedExtensionLayoutsInCompactOutput = () => {
  const fakeThis = createShowLoadedResourcesThis({
    extensions: createExtensionFixtures(),
    quietStartup: false,
  });

  (InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
    force: false,
  });

  expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  @scope/msa-scoped, answer.ts, cli-extension.ts, HazAT/pi-interactive-subagents, HazAT/pi-interactive-subagents:subagents, local-index, msa-markdown-preview, user-index"`);
};

const addsMoreParentFoldersUntilLocalExtension = () => {
  const extensions: interactiveModeStatus5SupportTypes.ExtensionFixture[] = [
    {
      path: "/tmp/alpha/one/index.ts",
      sourceInfo: createSourceInfo("/tmp/alpha/one/index.ts", {
        baseDir: "/tmp/alpha",
        origin: "top-level",
        scope: "temporary",
        source: "cli",
      }),
    },
    {
      path: "/tmp/beta/one/index.ts",
      sourceInfo: createSourceInfo("/tmp/beta/one/index.ts", {
        baseDir: "/tmp/beta",
        origin: "top-level",
        scope: "temporary",
        source: "cli",
      }),
    },
    {
      path: "/tmp/gamma/one/index.ts",
      sourceInfo: createSourceInfo("/tmp/gamma/one/index.ts", {
        baseDir: "/tmp/gamma",
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
  alpha/one, beta/one, gamma/one"`);
};

describe("InteractiveMode.showLoadedResources", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "captures mixed extension layouts in compact output",
    capturesMixedExtensionLayoutsInCompactOutput,
  );

  test(
    "adds more parent folders until local extension labels are unique",
    addsMoreParentFoldersUntilLocalExtension,
  );
});
