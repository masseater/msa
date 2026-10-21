import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import TasksView from "../src/modes/interactive/components/tasks-view.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { makeTempDir, removePath } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { initTheme } = themeModule;
const { stripAnsi } = ansi;

type Orchestrator = ReturnType<typeof setup>["orchestrator"];

const screen = (orchestrator: Orchestrator): string => {
  initTheme(undefined, false);
  const view = new TasksView({
    maxHeight: () => 40,
    onClose: () => {},
    onError: () => {},
    onPickModel: () => {},
    orchestrator,
    requestRender: () => {},
  });
  return view.render(100).map(stripAnsi).join("\n");
};

const roundsOfTasks = (orchestrator: Orchestrator) =>
  [...new Set(orchestrator.snapshot.tasks.map((task) => task.round))].sort();

const roundIds = (orchestrator: Orchestrator) =>
  orchestrator.snapshot.rounds.map((round) => round.id).sort();

const showsTheTasksOfARoundAReplanCreated = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const first = yield* create(orchestrator, {
        currentState: "x",
        goalState: "y",
        round: "first",
        title: "old",
      });
      yield* waitFor(() => taskStatus(orchestrator, first.id) === "running");
      yield* Effect.promise(() =>
        orchestrator.replan({
          keep: [first.id],
          reason: "split",
          stop: false,
          tasks: [{ currentState: "a", goalState: "b", round: "second", title: "new-in-second" }],
        }),
      );
      const created = orchestrator.snapshot.tasks.find((task) => task.title === "new-in-second");
      if (created === undefined) throw new Error("replan created no task");
      yield* waitFor(() => taskStatus(orchestrator, created.id) === "running");
      yield* Effect.promise(() => orchestrator.refresh());

      expect(roundIds(orchestrator)).toEqual(roundsOfTasks(orchestrator));
      const shown = screen(orchestrator);
      expect(shown).toContain("old");
      expect(shown).toContain("new-in-second");
      expect(shown).toContain("Review of second");
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("shows the tasks of a round a replan created", showsTheTasksOfARoundAReplanCreated);

const addsMissingRoundRowsWhenTheDatabaseOpens = () =>
  Effect.gen(function* () {
    const directory = yield* makeTempDir("msa-orchestrator-rounds-");
    const databasePath = `${directory}/orchestrator.db`;
    const before = setup({ databasePath });
    yield* create(before.orchestrator, {
      currentState: "x",
      goalState: "y",
      round: "lost",
      title: "orphaned",
    });
    before.orchestrator.database.prepare("DELETE FROM rounds WHERE id = 'lost'").run();
    yield* Effect.promise(() => before.orchestrator.dispose());

    const after = setup({ databasePath });

    expect(roundIds(after.orchestrator)).toEqual(["lost"]);
    expect(screen(after.orchestrator)).toContain("orphaned");
    yield* Effect.promise(() => after.orchestrator.dispose());
    yield* removePath(directory);
  });

it("adds missing round rows when the database opens", () =>
  Effect.runPromise(Effect.scoped(addsMissingRoundRowsWhenTheDatabaseOpens())));
