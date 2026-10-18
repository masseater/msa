import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createEventBus } from "../../../src/core/event-bus.ts";
import {
  createExtensionRuntime,
  loadExtensionFromFactory,
} from "../../../src/core/extensions/loader.ts";
import type { ExtensionAPI, ExtensionFactory, ResourceLoader } from "../../../src/index.ts";
import { createHarness, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const removesExtensionOwnedEventBusListeners = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const eventBus = createEventBus();
  let extensionCalls = 0;
  let hostCalls = 0;
  let firstApi: ExtensionAPI | undefined;
  const factory: ExtensionFactory = (msa) => {
    firstApi ??= msa;
    msa.events.on("reload:test", () => extensionCalls++);
  };
  eventBus.on("reload:test", () => hostCalls++);

  const loadExtensions = () =>
    runPromise(
      Effect.gen(function* () {
        const runtime = createExtensionRuntime();
        const extension = yield* Effect.promise(() =>
          loadExtensionFromFactory(factory, process.cwd(), eventBus, runtime),
        );
        return { extensions: [extension], errors: [], runtime };
      }),
    );
  let extensionsResult = yield* Effect.promise(() => loadExtensions());
  const resourceLoader: ResourceLoader = {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: () =>
      runPromise(
        Effect.gen(function* () {
          extensionsResult = yield* Effect.promise(() => loadExtensions());
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ resourceLoader }));
  harnesses.push(harness);
  yield* Effect.promise(() => harness.session.bindExtensions({ shutdownHandler: () => {} }));

  const emit = () =>
    runPromise(
      Effect.gen(function* () {
        const extensionBefore = extensionCalls;
        const hostBefore = hostCalls;
        eventBus.emit("reload:test", undefined);
        yield* Effect.sleep("0 millis");
        return { extension: extensionCalls - extensionBefore, host: hostCalls - hostBefore };
      }),
    );

  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 1, host: 1 });
  yield* Effect.promise(() => harness.session.reload());
  expect(() => firstApi?.getCommands()).toThrow("stale after session replacement or reload");
  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 1, host: 1 });
  yield* Effect.promise(() => harness.session.reload());
  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 1, host: 1 });

  harness.session.dispose();
  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 0, host: 1 });
});

describe("issue #7193 extension event-bus lifecycle", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("removes extension-owned event-bus listeners on reload and dispose", () =>
    Effect.runPromise(removesExtensionOwnedEventBusListeners));
});
