import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import eventBusModule from "../../../src/core/event-bus.ts";
import loader from "../../../src/core/extensions/loader.ts";
import type srcTypes from "../../../src/index.types.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createEventBus } = eventBusModule;
const { createExtensionRuntime, loadExtensionFromFactory } = loader;

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

type ExtensionsResult = ReturnType<srcTypes.ResourceLoader["getExtensions"]>;

const reloadingResourceLoader = (
  initial: ExtensionsResult,
  load: () => Promise<ExtensionsResult>,
): srcTypes.ResourceLoader => {
  let current = initial;
  return {
    extendResources: () => {},
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    getExtensions: () => current,
    getPrompts: () => ({ diagnostics: [], prompts: [] }),
    getSkills: () => ({ diagnostics: [], skills: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getThemes: () => ({ diagnostics: [], themes: [] }),
    reload: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          current = yield* Effect.promise(load);
        }),
      ),
  };
};

const removesExtensionOwnedEventBusListenersStep1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const eventBus = createEventBus();
    let extensionCalls = 0;
    let hostCalls = 0;
    let firstApi: srcTypes.ExtensionAPI | undefined;
    const factory: srcTypes.ExtensionFactory = (msa) => {
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
          return { errors: [], extensions: [extension], runtime };
        }),
      );
    const resourceLoader = reloadingResourceLoader(
      yield* Effect.promise(() => loadExtensions()),
      loadExtensions,
    );
    const harness = yield* Effect.promise(() => createHarness({ resourceLoader }));
    harnesses.push(harness);
    yield* Effect.promise(() =>
      harness.session.extensions.binding.bindExtensions({ shutdownHandler: () => {} }),
    );

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
    yield* Effect.promise(() => harness.session.extensions.runtime.reload());
    expect(() => firstApi?.getCommands()).toThrow("stale after session replacement or reload");
    return { emit, harness };
  });

const removesExtensionOwnedEventBusListeners = Effect.gen(function* () {
  const { emit, harness } = yield* removesExtensionOwnedEventBusListenersStep1();
  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 1, host: 1 });
  yield* Effect.promise(() => harness.session.extensions.runtime.reload());
  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 1, host: 1 });

  harness.session.dispose();
  expect(yield* Effect.promise(() => emit())).toEqual({ extension: 0, host: 1 });
});

const removesExtensionOwnedEventBusListenersOn = () =>
  Effect.runPromise(removesExtensionOwnedEventBusListeners);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #7193 extension event-bus lifecycle", () => {
  afterEach(afterEachHook);
  it(
    "removes extension-owned event-bus listeners on reload and dispose",
    removesExtensionOwnedEventBusListenersOn,
  );
});
