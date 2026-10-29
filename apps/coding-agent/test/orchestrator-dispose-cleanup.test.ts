import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import storeModule from "../src/core/orchestrator/store.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath } = testing;
const { store } = storeModule;
const { create } = orchestratorSupport;
const { setup, taskStatus, withTempDir } = orchestratorHarness.harness;
const { cleanedUp, holdBranchDeletion, reviewed, withRemote } = pullRequestSupport;
const { sh } = worktreeSupport;

const disposesOnlyAfterTheCleanupTheMergeStarted = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { repository } = remote;
        const { orchestrator, workers, branch, taskId, worktree } = yield* reviewed(remote);
        const deletion = yield* holdBranchDeletion(repository, branch);
        workers[1]!.complete("acceptable");
        yield* deletion.entered;
        expect(taskStatus(orchestrator, taskId)).toBe("running");

        let disposed = false;
        const disposing = orchestrator.dispose().then(() => {
          disposed = true;
          return undefined;
        });
        yield* Effect.sleep(100);
        expect(disposed).toBe(false);

        yield* deletion.release;
        yield* Effect.promise(() => disposing);
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "returns from dispose only after the worktree, branch, and origin branch a harness merge started removing are gone",
  disposesOnlyAfterTheCleanupTheMergeStarted,
);

const disposesOnlyAfterTheTranscriptItStartedReadingIsRead = () =>
  Effect.runPromise(
    withTempDir("msa-dispose-transcript-", (directory) =>
      Effect.gen(function* () {
        const databasePath = joinPath(directory, "orchestrator.db");
        const transcript = joinPath(directory, "held.jsonl");
        yield* sh(`mkfifo ${transcript}`, directory);
        const first = setup({ databasePath });
        yield* create(first.orchestrator, {
          currentState: "a.txt is missing",
          goalState: "a.txt exists",
          title: "a",
        });
        const threadId = first.orchestrator.snapshot.threads[0]!.id;
        yield* Effect.promise(() => first.orchestrator.dispose());
        const database = store.openDatabase(databasePath);
        database
          .prepare("UPDATE threads SET session_file = ? WHERE id = ?")
          .run(transcript, threadId);
        database.close();

        const { orchestrator } = setup({ databasePath });
        expect(orchestrator.messages(threadId)).toEqual([]);
        let disposed = false;
        const disposing = orchestrator.dispose().then(() => {
          disposed = true;
          return undefined;
        });
        yield* Effect.sleep(100);
        const heldUntilRead = !disposed;
        yield* sh(`: > ${transcript}`, directory);
        yield* Effect.promise(() => disposing);
        expect(heldUntilRead).toBe(true);
      }),
    ),
  );

it(
  "returns from dispose only after a transcript it started reading is read",
  disposesOnlyAfterTheTranscriptItStartedReadingIsRead,
);
