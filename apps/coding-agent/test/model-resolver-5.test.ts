import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  createSession,
  opus,
  removeSessionDirs,
  sonnet,
} from "./model-resolver-session-support.ts";

afterEach(() => runTest(removeSessionDirs));

describe("default model selection", () => {
  describe("persisted default model scoping", () => {
    test("adds a persisted default to an existing scoped model list", () =>
      runTest(
        Effect.gen(function* () {
          const { session, settingsManager } = yield* createSession({
            scoped: true,
            persistedScope: [`${sonnet.provider}/${sonnet.id}`],
          });

          yield* awaited(session.setModel(opus, { persist: true }));

          expect(settingsManager.getDefaultProvider()).toBe(opus.provider);
          expect(settingsManager.getDefaultModel()).toBe(opus.id);
          expect(
            session.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`),
          ).toEqual([`${sonnet.provider}/${sonnet.id}`, `${opus.provider}/${opus.id}`]);
          expect(settingsManager.getEnabledModels()).toEqual([
            `${sonnet.provider}/${sonnet.id}`,
            `${opus.provider}/${opus.id}`,
          ]);
        }),
      ));

    test("does not create a scoped model list when all models are available", () =>
      runTest(
        Effect.gen(function* () {
          const { session, settingsManager } = yield* createSession({ scoped: false });

          yield* awaited(session.setModel(opus, { persist: true }));

          expect(session.scopedModels).toEqual([]);
          expect(settingsManager.getEnabledModels()).toBeUndefined();
        }),
      ));

    test("keeps session-only model changes out of scope", () =>
      runTest(
        Effect.gen(function* () {
          const { session, settingsManager } = yield* createSession({
            scoped: true,
            persistedScope: [`${sonnet.provider}/${sonnet.id}`],
          });

          yield* awaited(session.setModel(opus, { persist: false }));

          expect(
            session.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`),
          ).toEqual([`${sonnet.provider}/${sonnet.id}`]);
          expect(settingsManager.getEnabledModels()).toEqual([`${sonnet.provider}/${sonnet.id}`]);
        }),
      ));
  });
});
