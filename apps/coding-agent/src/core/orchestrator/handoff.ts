import { Effect } from "effect";

import errors from "./errors.ts";
import handoffEnvironment from "./handoff-environment.ts";
import handoffFiles from "./handoff-files.ts";
import handoffRender from "./handoff-render.ts";
import type handoffTypes from "./handoff.types.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import snapshotModule from "./snapshot.ts";
import storeModule from "./store.ts";

const { renderHandoff, runningNotice } = handoffRender;
const { nowMillis } = runtimeModule;
const { orchestratorError } = errors;
const { snapshots } = snapshotModule;
const { gatherEnvironment } = handoffEnvironment;
const { handoffPath, saveHandoff } = handoffFiles;
const { store } = storeModule;

const SECTION_KEYS = ["premise", "goals", "donts"] as const;

function requireSections(input: handoffTypes.HandoffInput): void {
  for (const key of SECTION_KEYS) {
    if (input[key].trim() === "") {
      throw new Error(`A handoff needs ${key}; write "none" when there is nothing to say`);
    }
  }
}

function write(
  runtime: runtimeTypes.Runtime,
  input: handoffTypes.HandoffInput,
): Effect.Effect<handoffTypes.HandoffResult, ReturnType<typeof orchestratorError>> {
  return Effect.gen(function* () {
    yield* Effect.try({ catch: orchestratorError, try: () => requireSections(input) });
    const createdAt = yield* nowMillis;
    const { project, cwd, version, handoffDirectory } = runtime.options;
    const snapshot = snapshots.buildSnapshot(
      runtime.database,
      project,
      runtime.maxConcurrentThreads,
    );
    const attempt = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({ catch: orchestratorError, try: run });
    const environment = yield* attempt(() => gatherEnvironment(cwd, version));
    const path = yield* attempt(() => handoffPath(handoffDirectory, cwd, createdAt, input.path));
    const content = renderHandoff({
      createdAt,
      environment,
      notes: store.listNotes(runtime.database, project),
      sections: input,
      snapshot,
    });
    yield* attempt(() => saveHandoff(path, content));
    const running = snapshot.tasks.filter((task) => task.status === "running").length;
    return {
      line: `${path} を読んで再開して`,
      notice: running > 0 ? runningNotice(running) : undefined,
      path,
      running,
      tasks: snapshot.tasks.length,
    };
  });
}

const handoffs = { write };

const handoff = {
  handoffs,
};

export default handoff;
