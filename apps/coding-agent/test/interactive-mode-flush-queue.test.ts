import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import emptyEnterBurstModule from "../src/modes/interactive/empty-enter-burst.ts";
import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import interactiveModeFlushQueueSupport from "./interactive-mode-flush-queue-support.ts";
const { EMPTY_ENTER_BURST_IDLE } = emptyEnterBurstModule;

const { awaited, joinPath, makeTempDir, removePath, runTest, toJsonText, writeTextFile } = testing;
const { createHarness } = interactiveModeFlushQueueSupport;

type SubmitHandler = (text: string) => unknown;

const attachSubmitHandler = (
  session: agentSessionTypes.AgentSession,
  statuses: string[],
): SubmitHandler => {
  const proto = InteractiveMode.prototype;
  const handleEmptyEnter = Reflect.get(proto, "handleEmptyEnter") as (this: object) => void;
  const setupEditorSubmitHandler = Reflect.get(proto, "setupEditorSubmitHandler") as (
    this: object,
  ) => void;
  const fake = {
    defaultEditor: { onSubmit: undefined as SubmitHandler | undefined },
    editor: { addToHistory: () => {}, setText: () => {} },
    emptyEnterBurst: EMPTY_ENTER_BURST_IDLE,
    handleEmptyEnter: () => handleEmptyEnter.call(fake),
    session,
    showStatus: (message: string) => statuses.push(message),
    ui: { requestRender: () => {} },
    updatePendingMessagesDisplay: () => {},
  };
  Object.setPrototypeOf(fake, InteractiveMode.prototype);
  setupEditorSubmitHandler.call(fake);
  return fake.defaultEditor.onSubmit!;
};

let tempDir: string;

let session: agentSessionTypes.AgentSession | undefined;

let clock: number;

const startHarness = () =>
  Effect.tap(
    createHarness(
      tempDir,
      (at) => {
        clock = at;
      },
      attachSubmitHandler,
    ),
    (harness) =>
      Effect.sync(() => {
        ({ session } = harness);
      }),
  );

const prepareWorkspace = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-flush-queue-test-");
      yield* writeTextFile(
        joinPath(tempDir, "settings.json"),
        yield* toJsonText({ memory: { enabled: false } }),
      );
      clock = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
    }),
  );

const cleanWorkspace = () =>
  runTest(
    Effect.gen(function* () {
      vi.restoreAllMocks();
      session?.dispose();
      session = undefined;
      yield* removePath(tempDir);
    }),
  );

const sendsEveryQueuedMessageInInputOrder = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* startHarness();
      yield* harness.pressEnter("A", 1_000_000);
      yield* awaited(harness.session.prompt("B", { streamingBehavior: "followUp" }));
      yield* harness.pressEnter("C", 1_000_050);
      expect(harness.session.getSteeringMessages()).toEqual(["A", "C"]);
      expect(harness.session.getFollowUpMessages()).toEqual(["B"]);

      yield* harness.pressEnter("", 1_000_100);
      yield* harness.pressEnter("", 1_000_200);
      expect(harness.statuses).toEqual([]);
      yield* harness.pressEnter("", 1_000_300);

      expect(harness.statuses).toEqual(["Sent 3 queued messages"]);
      harness.release();
      yield* awaited(harness.firstRun);

      expect(harness.requests).toHaveLength(2);
      expect(harness.requests[1]).toEqual(["start", "A", "B", "C"]);
      expect(harness.session.pendingMessageCount).toBe(0);
      expect(harness.queueEvents.at(-1)).toEqual({ followUp: [], steering: [] });
    }),
  );

const resetsTheCountAfterALongGap = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* startHarness();
      yield* harness.pressEnter("A", 1_000_000);
      yield* harness.pressEnter("", 1_000_100);
      yield* harness.pressEnter("", 1_000_200);
      yield* harness.pressEnter("", 1_001_201);
      yield* harness.pressEnter("", 1_001_300);

      expect(harness.statuses).toEqual([]);
      expect(harness.session.pendingMessageCount).toBe(1);

      yield* harness.pressEnter("", 1_001_400);
      expect(harness.statuses).toEqual(["Sent 1 queued message"]);

      harness.release();
      yield* awaited(harness.firstRun);
    }),
  );

const ignoresEntersWithText = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* startHarness();
      yield* harness.pressEnter("A", 1_000_000);
      yield* harness.pressEnter("", 1_000_100);
      yield* harness.pressEnter("", 1_000_200);
      yield* harness.pressEnter("B", 1_000_300);
      yield* harness.pressEnter("", 1_000_400);

      expect(harness.statuses).toEqual([]);
      expect(harness.session.getSteeringMessages()).toEqual(["A", "B"]);

      harness.release();
      yield* awaited(harness.firstRun);
    }),
  );

const doesNothingWithAnEmptyQueue = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* startHarness();
      yield* harness.pressEnter("", 1_000_000);
      yield* harness.pressEnter("", 1_000_100);
      yield* harness.pressEnter("", 1_000_200);

      expect(harness.statuses).toEqual([]);
      expect(harness.session.pendingMessageCount).toBe(0);
      expect(harness.queueEvents).toEqual([]);

      harness.release();
      yield* awaited(harness.firstRun);
      expect(harness.requests).toHaveLength(1);
    }),
  );

describe("InteractiveMode empty Enter flush", () => {
  beforeEach(prepareWorkspace);

  afterEach(cleanWorkspace);

  test(
    "three empty Enters send every queued message in input order and empty the queue",
    sendsEveryQueuedMessageInInputOrder,
  );

  test(
    "a gap longer than one second between empty Enters resets the count",
    resetsTheCountAfterALongGap,
  );

  test("an Enter with text does not count toward the three presses", ignoresEntersWithText);

  test("three empty Enters with nothing queued do nothing", doesNothingWithAnEmptyQueue);
});
