import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type codingAgentTypes from "../src/index.types.ts";
import agentSessionProviderFallbackSupport from "./agent-session-provider-fallback-support.ts";
import sessionKit from "./session-kit.ts";

const { awaited, pollUntil, runTest, toJsonText } = testing;
const { disposeWorkspace, prepareWorkspace } = sessionKit;
const { CREDITS_ERROR, providerStream, startFallbackSession } = agentSessionProviderFallbackSupport;

let tempDir = "";
let session: codingAgentTypes.AgentSession | undefined;

const start = (
  stream: ReturnType<typeof providerStream>,
  scoped: Parameters<typeof startFallbackSession>[2],
) =>
  Effect.tap(startFallbackSession(tempDir, stream, scoped), (created) =>
    Effect.sync(() => {
      session = created.session;
    }),
  );

const switchesToTheNextEnabledModel = () =>
  runTest(
    Effect.gen(function* () {
      const stream = providerStream(new Set(["openrouter"]));
      const {
        anthropic,
        events,
        openrouter,
        session: created,
      } = yield* start(stream, (models) => [models.openrouter, models.anthropic]);

      yield* awaited(created.run.prompting.prompt("Go"));

      expect(stream.calls).toEqual(["openrouter", "anthropic-api"]);
      expect(events).toEqual([
        `fallback:openrouter/${openrouter.id}->anthropic-api/${anthropic.id}`,
      ]);
      expect(created.model?.provider).toBe("anthropic-api");
      expect(created.run.fallback.stalled).toBeUndefined();
      const resent = yield* toJsonText(stream.contexts[1]!.messages);
      expect(resent).toContain("Go");
      expect(resent).not.toContain("requires more credits");
    }),
  );

const stopsOnceAndRecordsTheStop = () =>
  runTest(
    Effect.gen(function* () {
      const stream = providerStream(new Set(["openrouter"]));
      const {
        events,
        openrouter,
        session: created,
      } = yield* start(stream, (models) => [models.openrouter]);

      yield* awaited(created.run.prompting.prompt("Go"));
      yield* awaited(
        created.run.prompting.sendCustomMessage(
          { content: "task t-1 finished", customType: "msa.orchestrator.report", display: true },
          { deliverAs: "followUp", triggerTurn: true },
        ),
      );

      expect(stream.calls).toEqual(["openrouter", "openrouter"]);
      expect(events).toEqual([`stalled:openrouter/${openrouter.id}`]);
      expect(created.run.fallback.stalled).toMatchObject({
        errorMessage: CREDITS_ERROR,
        model: `openrouter/${openrouter.id}`,
      });
      const transcript = yield* toJsonText(created.agent.state.messages);
      expect(transcript).toMatch(
        /Model calls stopped at \d{4}-\d{2}-\d{2} \d{2}:\d{2}: openrouter\//u,
      );
      expect(transcript).toContain("requires more credits");
    }),
  );

const resumesWithTheReportsAfterTheModelIsSwitched = () =>
  runTest(
    Effect.gen(function* () {
      const stream = providerStream(new Set(["openrouter"]));
      const {
        anthropic,
        events,
        session: created,
      } = yield* start(stream, (models) => [models.openrouter]);
      yield* awaited(created.run.prompting.prompt("Go"));
      yield* awaited(
        created.run.prompting.sendCustomMessage(
          { content: "task t-1 finished", customType: "msa.orchestrator.report", display: true },
          { deliverAs: "followUp", triggerTurn: true },
        ),
      );

      yield* awaited(created.models.selection.setModel(anthropic));
      yield* pollUntil(
        Effect.sync(() => events.includes(`recovered:anthropic-api/${anthropic.id}`)),
        200,
        5,
      );
      yield* awaited(created.run.lifecycle.waitForIdle());

      expect(stream.calls.at(-1)).toBe("anthropic-api");
      expect(yield* toJsonText(stream.contexts.at(-1)!.messages)).toContain("task t-1 finished");
      expect(created.run.fallback.stalled).toBeUndefined();
      expect(events).not.toContain("retry");
    }),
  );

const choosesAFailedProviderAgainAfterASuccess = () =>
  runTest(
    Effect.gen(function* () {
      const failing = new Set(["openrouter"]);
      const stream = providerStream(failing);
      const {
        anthropic,
        events,
        openrouter,
        session: created,
      } = yield* start(stream, (models) => [models.openrouter, models.anthropic]);
      yield* awaited(created.run.prompting.prompt("Go"));

      failing.clear();
      failing.add("anthropic-api");
      yield* awaited(created.run.prompting.prompt("Again"));

      expect(stream.calls).toEqual(["openrouter", "anthropic-api", "anthropic-api", "openrouter"]);
      expect(events).toEqual([
        `fallback:openrouter/${openrouter.id}->anthropic-api/${anthropic.id}`,
        `fallback:anthropic-api/${anthropic.id}->openrouter/${openrouter.id}`,
      ]);
      expect(created.run.fallback.stalled).toBeUndefined();
    }),
  );

const resumesWhenTheModelIsCycled = () =>
  runTest(
    Effect.gen(function* () {
      const failing = new Set(["openrouter", "anthropic-api"]);
      const stream = providerStream(failing);
      const {
        events,
        openrouter,
        session: created,
      } = yield* start(stream, (models) => [models.openrouter, models.anthropic]);
      yield* awaited(created.run.prompting.prompt("Go"));
      expect(created.model?.provider).toBe("anthropic-api");
      expect(created.run.fallback.stalled).toBeDefined();

      failing.delete("openrouter");
      yield* awaited(created.models.selection.cycleModel("forward"));
      yield* pollUntil(
        Effect.sync(() => events.includes(`recovered:openrouter/${openrouter.id}`)),
        200,
        5,
      );
      yield* awaited(created.run.lifecycle.waitForIdle());

      expect(stream.calls.at(-1)).toBe("openrouter");
      expect(created.run.fallback.stalled).toBeUndefined();
    }),
  );

const notifiesASecondStopAfterTheModelIsSwitched = () =>
  runTest(
    Effect.gen(function* () {
      const stream = providerStream(new Set(["openrouter", "anthropic-api"]));
      const {
        anthropic,
        events,
        openrouter,
        session: created,
      } = yield* start(stream, (models) => [models.openrouter]);
      yield* awaited(created.run.prompting.prompt("Go"));

      yield* awaited(created.models.selection.setModel(anthropic));
      yield* pollUntil(
        Effect.sync(() => events.filter((event) => event.startsWith("stalled:")).length === 2),
        200,
        5,
      );
      yield* awaited(created.run.lifecycle.waitForIdle());

      expect(events).toEqual([
        `stalled:openrouter/${openrouter.id}`,
        `fallback:anthropic-api/${anthropic.id}->openrouter/${openrouter.id}`,
        `stalled:openrouter/${openrouter.id}`,
      ]);
      expect(created.run.fallback.stalled).toBeDefined();
      const transcript = yield* toJsonText(created.agent.state.messages);
      expect(transcript.match(/Model calls stopped at/gu)).toHaveLength(2);
    }),
  );

describe("provider fallback", () => {
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* prepareWorkspace("msa-provider-fallback-");
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* disposeWorkspace(session, tempDir);
        session = undefined;
        tempDir = "";
      }),
    ),
  );

  it("switches to the next enabled model on a 402 and resends the request without the failure", () =>
    switchesToTheNextEnabledModel());
  it("stops once and records the time and the error when no enabled model can take over", () =>
    stopsOnceAndRecordsTheStop());
  it("resumes with the reports that arrived once the model is switched", () =>
    resumesWithTheReportsAfterTheModelIsSwitched());
  it("can choose a provider that failed earlier once a request has succeeded", () =>
    choosesAFailedProviderAgainAfterASuccess());
  it("resumes when the model is cycled with Ctrl+P", () => resumesWhenTheModelIsCycled());
  it("notifies and records a second stop after the model is switched", () =>
    notifiesASecondStopAfterTheModelIsSwitched());
});
