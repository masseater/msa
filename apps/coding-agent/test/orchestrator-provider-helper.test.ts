import { Clock, Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import providerWaitSupport from "./provider-wait-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { setup, taskStatus } = orchestratorHarness.harness;
const { TASK, advance, fakeClock, storedStatus } = watchdogSupport;
const { HOUR, MINUTE, sessionLimit, settledUntil } = providerWaitSupport;
const { isTriage } = triageSupport;
const { withRepository } = worktreeSupport;

afterEach(() => {
  vi.useRealTimers();
});

const REQUEST = {
  options: [
    { choice: "Keep the old cache keys", tradeoffs: "Stale entries stay until they expire" },
    { choice: "Flush the cache", tradeoffs: "A cold start on every reader" },
  ],
  unmet: "The goal asks for warm reads and for fresh keys; both cannot hold at once.",
};

const decisionRequested = (repository: string) =>
  Effect.gen(function* () {
    yield* fakeClock();
    const started = setup({ cwd: repository, pollIntervalMs: 5000 });
    const task = yield* create(started.orchestrator, TASK);
    const worker = started.workers[0];
    if (worker === undefined) throw new Error("no worker started");
    yield* Effect.promise(() => worker.requestDecision(REQUEST));
    yield* settledUntil(() => started.workers.length === 2);
    const triage = started.workers[1];
    if (triage === undefined || !isTriage(triage)) throw new Error("no triage started");
    return { ...started, task, triage, worker };
  });

const limitHits = (thread: { endTurnWithError: (failure: object) => void }) =>
  Effect.gen(function* () {
    thread.endTurnWithError(sessionLimit((yield* Clock.currentTimeMillis) + HOUR));
    yield* advance(0);
  });

const afterReset = advance(HOUR + MINUTE + 10_000);

const advisorWaitsOutTheLimitAlone = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, task, triage, worker, workers } =
          yield* decisionRequested(repository);
        yield* Effect.promise(() => triage.escalate());
        yield* settledUntil(() => taskStatus(orchestrator, task.id) === "needs-decision");
        yield* Effect.promise(() => orchestrator.advise(task.id, "Which readers go cold?"));
        yield* settledUntil(() => workers.length === 3);
        const advisor = workers[2]!;

        yield* limitHits(advisor);
        expect(storedStatus(orchestrator, task.id)).toBe("needs-decision");

        yield* afterReset;
        yield* settledUntil(() => workers.length === 4);
        const resumed = workers[3]!;
        expect(resumed.readOnly).toBe(true);
        expect(resumed.tools).toEqual([]);
        expect(resumed.openedSessionFile).toBe(advisor.sessionFile);
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");

        yield* advance(3 * HOUR);
        expect(workers).toHaveLength(4);
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");

        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Keep the old keys."));
        yield* settledUntil(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain("Keep the old keys.");
        expect(workers).toHaveLength(4);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        yield* Effect.promise(() => orchestrator.dispose());
      }),
    ),
  );

it(
  "keeps a task waiting for the decision while its advisor waits out a provider limit, resumes only the advisor in its own session, and starts no new worker before the answer",
  advisorWaitsOutTheLimitAlone,
);

const triageWaitsOutTheLimitAlone = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, task, triage, worker, workers } =
          yield* decisionRequested(repository);

        yield* limitHits(triage);
        expect(storedStatus(orchestrator, task.id)).toBe("running");

        yield* afterReset;
        yield* settledUntil(() => workers.length === 3);
        const resumed = workers[2]!;
        expect(isTriage(resumed)).toBe(true);
        expect(resumed.openedSessionFile).toBe(triage.sessionFile);

        yield* Effect.promise(() => resumed.escalate());
        yield* settledUntil(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(workers).toHaveLength(3);

        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Flush the cache."));
        yield* settledUntil(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain("Flush the cache.");
        expect(workers).toHaveLength(3);
        yield* Effect.promise(() => orchestrator.dispose());
      }),
    ),
  );

it(
  "resumes only the triage in its own session after a provider limit, keeps its request, and starts no new worker before the decision",
  triageWaitsOutTheLimitAlone,
);

const advisorStallsAgainAndTheTaskWaits = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, triage, worker, workers } =
          yield* decisionRequested(repository);
        yield* Effect.promise(() => triage.escalate());
        yield* settledUntil(() => taskStatus(orchestrator, task.id) === "needs-decision");
        yield* Effect.promise(() => orchestrator.advise(task.id, "Which readers go cold?"));
        yield* settledUntil(() => workers.length === 3);
        yield* limitHits(workers[2]!);
        yield* afterReset;
        yield* settledUntil(() => workers.length === 4);
        const reportsBefore = reports.length;

        yield* limitHits(workers[3]!);
        yield* settledUntil(() => reports.length > reportsBefore);
        expect(reports.at(-1)?.details).toMatchObject({ role: "advisor" });
        expect(storedStatus(orchestrator, task.id)).toBe("needs-decision");

        yield* advance(3 * HOUR);
        expect(workers).toHaveLength(4);
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");

        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Keep the old keys."));
        yield* settledUntil(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain("Keep the old keys.");
        expect(workers).toHaveLength(4);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        yield* Effect.promise(() => orchestrator.dispose());
      }),
    ),
  );

it(
  "leaves the advisor's report and keeps the task waiting for the decision when the resumed advisor stops on the same limit without progress, and answering resumes the worker's own session",
  advisorStallsAgainAndTheTaskWaits,
);

const triageStallsAgainAndTheTaskWaits = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, triage, worker, workers } =
          yield* decisionRequested(repository);
        yield* limitHits(triage);
        yield* afterReset;
        yield* settledUntil(() => workers.length === 3);

        yield* limitHits(workers[2]!);
        yield* settledUntil(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(reports.at(-1)?.details).toMatchObject({ status: "needs-decision" });
        expect(workers).toHaveLength(3);

        yield* advance(3 * HOUR);
        expect(workers).toHaveLength(3);
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");

        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Flush the cache."));
        yield* settledUntil(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain("Flush the cache.");
        expect(workers).toHaveLength(3);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        yield* Effect.promise(() => orchestrator.dispose());
      }),
    ),
  );

it(
  "sends the task to needs-decision when the resumed triage stops on the same limit without progress, starts no new thread, and answering resumes the worker's own session",
  triageStallsAgainAndTheTaskWaits,
);

const DECIDED = {
  conclusion: "decided",
  decision: "Keep the old cache keys; stale entries expire within the hour.",
  goalItems: [{ how: "Reads stay warm while the keys expire.", item: 1 }],
  grounds: "The goal names warm reads first, and the stale keys clear on their own.",
};

const resumedTriageRemembersItsRequest = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, triage, worker, workers } =
          yield* decisionRequested(repository);
        yield* limitHits(triage);
        yield* afterReset;
        yield* settledUntil(() => workers.length === 3);

        yield* Effect.promise(() => workers[2]!.concludeTriage(DECIDED));
        yield* settledUntil(() => worker.prompts.length === 2);
        expect(worker.prompts[1]).toContain(DECIDED.decision);

        yield* Effect.promise(() => worker.requestDecision(REQUEST));
        yield* settledUntil(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(workers).toHaveLength(3);
        expect(reports.at(-1)?.text).toContain("came back word for word");
        yield* Effect.promise(() => orchestrator.dispose());
      }),
    ),
  );

it(
  "remembers the request a triage resumed after a provider limit decided, so the same request coming back goes to a human",
  resumedTriageRemembersItsRequest,
);
