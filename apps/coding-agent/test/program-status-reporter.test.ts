import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";
import { describe, expect, it } from "vite-plus/test";

import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import { ProgramStatusReporter } from "../src/modes/interactive/program-status-reporter.ts";

function setup(sessionName?: string) {
  const reports: tuiTypes.ProgramStatus[] = [];
  const terminal = {
    setProgramStatus: (status: tuiTypes.ProgramStatus) => reports.push(status),
  } as unknown as tuiTypes.Terminal;
  const session = { name: sessionName };
  const reporter = new ProgramStatusReporter(
    () => terminal,
    () => session.name,
  );
  const send = (...events: AgentSessionEvent[]) => {
    for (const event of events) reporter.handleEvent(event);
  };
  const last = () => {
    const { app: _app, ...status } = reports.at(-1)!;
    return Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined));
  };
  return { last, reporter, reports, send, session };
}

function assistantEnd(
  stopReason: aiTypes.AssistantMessage["stopReason"],
  errorMessage?: string,
): AgentSessionEvent {
  const message = {
    content: [{ text: "secret assistant output", type: "text" }],
    errorMessage,
    role: "assistant",
    stopReason,
  } as aiTypes.AssistantMessage;
  return { message, type: "message_end" };
}

const settled: AgentSessionEvent = { aborted: false, type: "agent_settled" };

const compactionEnd = (
  reason: "manual" | "threshold" | "overflow",
  options: { aborted?: boolean; errorMessage?: string } = {},
): AgentSessionEvent => ({
  aborted: options.aborted ?? false,
  reason,
  result: undefined,
  type: "compaction_end",
  willRetry: false,
  ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
});

const reportsIdleWorkingDuringARunAnd = () => {
  const { reporter, reports, send, last } = setup("Fix login");
  reporter.report();
  expect(reports.at(-1)).toEqual({ app: "msa", state: "idle" });

  send({ type: "agent_start" });
  expect(last()).toEqual({ message: "Fix login", state: "working" });

  send(assistantEnd("toolUse"), assistantEnd("stop"));
  expect(last()).toEqual({ message: "Fix login", state: "working" });

  send(settled);
  expect(last()).toEqual({ message: "Fix login", state: "done" });
  expect(JSON.stringify(reports)).not.toContain("secret assistant output");
};

const reportsOnlyTheOutcomeOfTheRun = () => {
  const { send, last } = setup();
  send({ type: "agent_start" }, assistantEnd("error", "overloaded"), assistantEnd("stop"), settled);
  expect(last()).toEqual({ state: "done" });

  send({ type: "agent_start" }, assistantEnd("error", "Invalid API key\n{details}"), settled);
  expect(last()).toEqual({ message: "Invalid API key", state: "error" });

  send({ type: "agent_start" }, assistantEnd("aborted"), {
    aborted: true,
    type: "agent_settled",
  });
  expect(last()).toEqual({ state: "idle" });

  send({ type: "agent_start" }, assistantEnd("stop"), { aborted: true, type: "agent_settled" });
  expect(last()).toEqual({ state: "idle" });
};

const reportsAFailedRecoveryCompactionAsThe = () => {
  const { send, last } = setup();
  send(
    { type: "agent_start" },
    assistantEnd("length"),
    { reason: "overflow", type: "compaction_start" },
    compactionEnd("overflow", { errorMessage: "Compaction failed\nstack" }),
    settled,
  );
  expect(last()).toEqual({ message: "Compaction failed", state: "error" });

  send(
    { type: "agent_start" },
    { reason: "threshold", type: "compaction_start" },
    compactionEnd("threshold", { errorMessage: "Compaction failed" }),
    assistantEnd("stop"),
    settled,
  );
  expect(last()).toEqual({ state: "done" });
};

const reportsCompactionInsideARunAndThe = () => {
  const { send, last } = setup("Session");
  send({ type: "agent_start" }, { reason: "threshold", type: "compaction_start" });
  expect(last()).toEqual({ message: "Compacting context", state: "working" });
  send(compactionEnd("threshold"));
  expect(last()).toEqual({ message: "Session", state: "working" });
  send(assistantEnd("stop"), settled);

  send({ reason: "manual", type: "compaction_start" }, compactionEnd("manual"));
  expect(last()).toEqual({ message: "Session", state: "done" });
  send(
    { reason: "manual", type: "compaction_start" },
    compactionEnd("manual", { errorMessage: "No model" }),
  );
  expect(last()).toEqual({ message: "No model", state: "error" });
  send({ reason: "manual", type: "compaction_start" }, compactionEnd("manual", { aborted: true }));
  expect(last()).toEqual({ state: "idle" });
};

const reportsTheMostRecentOpenDialogAnd = () => {
  const { reporter, send, last } = setup();
  send({ type: "agent_start" });
  reporter.setBlocked("extension-selector", { kind: "permission", message: "Allow bash?" });
  reporter.setBlocked("login", { kind: "auth", message: "Log in to Anthropic" });
  expect(last()).toEqual({ kind: "auth", message: "Log in to Anthropic", state: "blocked" });

  reporter.setBlocked("login", undefined);
  send(assistantEnd("stop"), settled);
  expect(last()).toEqual({ kind: "permission", message: "Allow bash?", state: "blocked" });

  reporter.setBlocked("extension-selector", { kind: "question", message: "Pick one" });
  expect(last()).toEqual({ kind: "question", message: "Pick one", state: "blocked" });
  reporter.setBlocked("extension-selector", undefined);
  expect(last()).toEqual({ state: "done" });
};

const returnsToIdleWhenTheSessionIs = () => {
  const { reporter, send, last } = setup();
  send({ type: "agent_start" }, assistantEnd("stop"), settled);
  reporter.reset();
  expect(last()).toEqual({ state: "idle" });
};

describe("ProgramStatusReporter", () => {
  it(
    "reports idle, working during a run, and done once it settles",
    reportsIdleWorkingDuringARunAnd,
  );

  it(
    "reports only the outcome of the run: retried errors, final errors, and aborts",
    reportsOnlyTheOutcomeOfTheRun,
  );

  it(
    "reports a failed recovery compaction as the run's error unless a later response succeeds",
    reportsAFailedRecoveryCompactionAsThe,
  );

  it(
    "reports compaction inside a run and the result of a manual compaction",
    reportsCompactionInsideARunAndThe,
  );

  it(
    "reports the most recent open dialog and the underlying state once all close",
    reportsTheMostRecentOpenDialogAnd,
  );

  it("sends each status once and follows session name changes", () => {
    const { reporter, reports, session, send, last } = setup("Old");
    send(
      { type: "agent_start" },
      { type: "turn_start" } as AgentSessionEvent,
      assistantEnd("toolUse"),
    );
    reporter.report();
    expect(reports).toHaveLength(1);

    session.name = "New";
    send({ name: "New", type: "session_info_changed" });
    expect(last()).toEqual({ message: "New", state: "working" });
  });

  it("returns to idle when the session is replaced", returnsToIdleWhenTheSessionIs);
});
