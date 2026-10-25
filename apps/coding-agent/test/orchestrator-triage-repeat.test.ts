import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type FakeWorker from "./fake-worker.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import triageRequestSupport from "./triage-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { taskStatus, waitFor } = orchestratorHarness.harness;
const { DECIDED, REQUEST, decideOnce } = triageRequestSupport;
const { withRepository } = worktreeSupport;

type Stopped = Effect.Success<ReturnType<typeof decideOnce>>;

const ANSWER = "Not a repeat: name the adapter after the new API and keep going.";

const showsBothRequestsAndResumesOnTheAnswer = (stopped: Stopped, request: string) =>
  Effect.gen(function* () {
    const { dependent, orchestrator, reports, task, worker, workers } = stopped;
    const text = reports.at(-1)?.text ?? "";
    expect(text.slice(text.indexOf("<request>"), text.indexOf("</request>"))).toContain(request);
    expect(text).toContain('<repeated-decision number="1">');
    expect(text).toMatch(/<earlier-request>\n[\s\S]*?The goal asks to remove the old API/u);
    expect(text).toMatch(/<earlier-way>\n[\s\S]*?Route the old API's callers through an adapter/u);
    expect(text).toContain(DECIDED.grounds);
    expect(taskStatus(orchestrator, dependent.id)).toBe("waiting");

    const spawned = workers.length;
    const prompts = worker.prompts.length;
    yield* Effect.promise(() => orchestrator.sendMessage(task.id, ANSWER));
    yield* waitFor(() => worker.prompts.length === prompts + 1);
    expect(workers).toHaveLength(spawned);
    expect(worker.prompts.at(-1)).toContain(ANSWER);
    expect(worker.prompts.at(-1)).toContain("<decision-made>");
    expect(taskStatus(orchestrator, task.id)).toBe("running");
    expect(taskStatus(orchestrator, dependent.id)).toBe("waiting");
  });

const wordForWord = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const stopped = yield* decideOnce(repository);
        yield* Effect.promise(() => stopped.worker.requestDecision(REQUEST));
        yield* waitFor(
          () => taskStatus(stopped.orchestrator, stopped.task.id) === "needs-decision",
        );
        expect(stopped.workers).toHaveLength(2);
        expect(stopped.reports.at(-1)?.details).toMatchObject({
          role: "worker",
          status: "needs-decision",
        });
        expect(stopped.reports.at(-1)?.text).toContain(
          "The same request came back word for word after triage decision 1 decided it",
        );
        yield* showsBothRequestsAndResumesOnTheAnswer(stopped, REQUEST.unmet);
      }),
    ),
  );

it(
  "sends a word-for-word repeat to the orchestrator with the earlier request and its way beside it, and continues the worker's session with the orchestrator's answer",
  wordForWord,
);

const REWORDED = { ...REQUEST, unmet: "Removing the old API still breaks a caller." };

const judgedRepeat = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const stopped = yield* decideOnce(repository);
        yield* Effect.promise(() => stopped.worker.requestDecision(REWORDED));
        yield* waitFor(() => stopped.workers.length === 3);
        const second: FakeWorker = stopped.workers[2]!;
        expect(second.tools.map((tool) => tool.name)).toEqual(["conclude_triage"]);
        expect(second.prompts[0]).toContain('<decision number="1" files-changed-since="no">');
        yield* Effect.promise(() =>
          second.concludeTriage({
            conclusion: "repeat",
            decision: "The adapter way again.",
            grounds: "It asks what decision 1 answered.",
            repeats: 1,
          }),
        );
        yield* waitFor(
          () => taskStatus(stopped.orchestrator, stopped.task.id) === "needs-decision",
        );
        expect(stopped.reports.at(-1)?.details).toMatchObject({
          role: "triage",
          status: "needs-decision",
        });
        expect(stopped.reports.at(-1)?.text).toContain(
          "asks the same thing as earlier triage decision 1",
        );
        yield* showsBothRequestsAndResumesOnTheAnswer(stopped, REWORDED.unmet);
      }),
    ),
  );

it(
  "hands a request the triage judges a repeat to the orchestrator with this request and the repeated decision's request and way side by side, and continues the worker's session with the orchestrator's answer",
  judgedRepeat,
);
