import { Effect } from "effect";

import { type OrchestratorError, orchestratorError } from "./errors.ts";
import { gatherEnvironment } from "./handoff-environment.ts";
import { handoffPath, saveHandoff } from "./handoff-files.ts";
import { type HandoffSections, renderHandoff, runningNotice } from "./handoff-render.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { snapshots } from "./snapshot.ts";
import { store } from "./store.ts";

export interface HandoffInput extends HandoffSections {
  path?: string;
}

export interface HandoffResult {
  path: string;
  tasks: number;
  running: number;
  /** The line a person pastes into the next session. */
  line: string;
  /** Said after `line` while threads still run. */
  notice: string | undefined;
}

const SECTION_KEYS = ["premise", "goals", "donts"] as const;

function requireSections(input: HandoffSections): void {
  for (const key of SECTION_KEYS) {
    if (input[key].trim() === "") {
      throw new Error(`A handoff needs ${key}; write "none" when there is nothing to say`);
    }
  }
}

function write(
  runtime: Runtime,
  input: HandoffInput,
): Effect.Effect<HandoffResult, OrchestratorError> {
  return Effect.gen(function* () {
    yield* Effect.try({ try: () => requireSections(input), catch: orchestratorError });
    const createdAt = yield* nowMillis;
    const { project, cwd, version, handoffDirectory } = runtime.options;
    const snapshot = snapshots.buildSnapshot(
      runtime.database,
      project,
      runtime.maxConcurrentThreads,
    );
    const path = yield* Effect.tryPromise({
      try: async () => {
        const environment = await gatherEnvironment(cwd, version);
        const target = await handoffPath(handoffDirectory, cwd, createdAt, input.path);
        const content = renderHandoff({
          createdAt,
          environment,
          sections: input,
          snapshot,
          notes: store.listNotes(runtime.database, project),
        });
        await saveHandoff(target, content);
        return target;
      },
      catch: orchestratorError,
    });
    const running = snapshot.tasks.filter((task) => task.status === "running").length;
    return {
      path,
      tasks: snapshot.tasks.length,
      running,
      line: `${path} を読んで再開して`,
      notice: running > 0 ? runningNotice(running) : undefined,
    };
  });
}

export const handoffs = { write };
