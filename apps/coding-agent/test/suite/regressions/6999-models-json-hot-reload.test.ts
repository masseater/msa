import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { ModelSelectorComponent } from "../../../src/modes/interactive/components/model-selector.ts";
import modelRuntimeTestUtils from "../../model-runtime-test-utils.ts";
import tuiKit from "../../tui-kit.ts";

const { setKeybindings } = tuiModule;

const { KeybindingsManager, initTheme, stripAnsi } = tuiKit;

const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const { gate, joinPath, toJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

function observeRefreshRender(): { tui: tuiTypes.TUI; renderedAfterRefresh: Promise<void> } {
  let renderCount = 0;
  const renderedAfterRefresh = gate();
  return {
    renderedAfterRefresh,
    tui: {
      requestRender: () => {
        renderCount++;
        if (renderCount === 2) renderedAfterRefresh.release();
      },
    } as unknown as tuiTypes.TUI,
  };
}

function modelsJson(provider: string, model: string): Record<string, unknown> {
  return {
    providers: {
      [provider]: {
        api: "openai-completions",
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        models: [{ id: model }],
      },
    },
  };
}

let tempDir: string | undefined;

const reloadsModelsJsonWhenOpeningModel = Effect.gen(function* () {
  tempDir = yield* fs.makeTempDirectory({ prefix: "msa-models-json-hot-reload-" });
  const modelsPath = joinPath(tempDir, "models.json");
  yield* fs.writeFileString(modelsPath, yield* toJsonText(modelsJson("old-provider", "old-model")));
  const modelRuntime = getModelRuntime(
    yield* Effect.promise(() => createModelRegistry(AuthStorage.inMemory(), modelsPath)),
  );
  expect(modelRuntime.getModel("old-provider", "old-model")).toBeDefined();

  yield* fs.writeFileString(modelsPath, yield* toJsonText(modelsJson("new-provider", "new-model")));
  const { tui, renderedAfterRefresh } = observeRefreshRender();
  const selector = new ModelSelectorComponent(
    tui,
    undefined,
    modelRuntime,
    [],
    () => {},
    () => {},
  );

  yield* Effect.promise(() => renderedAfterRefresh);
  const rendered = stripAnsi(selector.render(120).join("\n"));
  expect(rendered).toContain("new-model [new-provider]");
  expect(rendered).not.toContain("old-model [old-provider]");
});

const reloadsModelsJsonWhenOpeningModel2 = () =>
  Effect.runPromise(reloadsModelsJsonWhenOpeningModel);

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      if (tempDir !== undefined && tempDir !== "")
        yield* fs.remove(tempDir, { force: true, recursive: true });
      tempDir = undefined;
    }),
  );

describe("issue #6999 models.json hot reload", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });
  afterEach(afterEachHook);
  it("reloads models.json when opening /model", reloadsModelsJsonWhenOpeningModel2);
});
