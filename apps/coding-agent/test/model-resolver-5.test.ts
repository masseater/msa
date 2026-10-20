import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test } from "vite-plus/test";

import modelResolverSessionSupport from "./model-resolver-session-support.ts";

const { createSession, opus, removeSessionDirs, sonnet } = modelResolverSessionSupport;

const { awaited, runTest } = testing;

afterEach(() => runTest(removeSessionDirs));

const addsAPersistedDefaultToAnExisting = () =>
  runTest(
    Effect.gen(function* () {
      const { session, settingsManager } = yield* createSession({
        persistedScope: [`${sonnet.provider}/${sonnet.id}`],
        scoped: true,
      });

      yield* awaited(session.models.selection.setModel(opus, { persist: true }));

      expect(settingsManager.getDefaultProvider()).toBe(opus.provider);
      expect(settingsManager.getDefaultModel()).toBe(opus.id);
      expect(
        session.models.selection.scopedModels.map(
          (scoped) => `${scoped.model.provider}/${scoped.model.id}`,
        ),
      ).toEqual([`${sonnet.provider}/${sonnet.id}`, `${opus.provider}/${opus.id}`]);
      expect(settingsManager.getEnabledModels()).toEqual([
        `${sonnet.provider}/${sonnet.id}`,
        `${opus.provider}/${opus.id}`,
      ]);
    }),
  );

const doesNotCreateAScopedModelList = () =>
  runTest(
    Effect.gen(function* () {
      const { session, settingsManager } = yield* createSession({ scoped: false });

      yield* awaited(session.models.selection.setModel(opus, { persist: true }));

      expect(session.models.selection.scopedModels).toEqual([]);
      expect(settingsManager.getEnabledModels()).toBeUndefined();
    }),
  );

const keepsSessionOnlyModelChangesOutOf = () =>
  runTest(
    Effect.gen(function* () {
      const { session, settingsManager } = yield* createSession({
        persistedScope: [`${sonnet.provider}/${sonnet.id}`],
        scoped: true,
      });

      yield* awaited(session.models.selection.setModel(opus, { persist: false }));

      expect(
        session.models.selection.scopedModels.map(
          (scoped) => `${scoped.model.provider}/${scoped.model.id}`,
        ),
      ).toEqual([`${sonnet.provider}/${sonnet.id}`]);
      expect(settingsManager.getEnabledModels()).toEqual([`${sonnet.provider}/${sonnet.id}`]);
    }),
  );

describe("default model selection", () => {
  describe("persisted default model scoping", () => {
    test(
      "adds a persisted default to an existing scoped model list",
      addsAPersistedDefaultToAnExisting,
    );

    test(
      "does not create a scoped model list when all models are available",
      doesNotCreateAScopedModelList,
    );

    test("keeps session-only model changes out of scope", keepsSessionOnlyModelChangesOutOf);
  });
});
