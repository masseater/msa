import type tuiTypes from "@msa/tui/index.types";

import config from "../../config.ts";
import type agentSessionTypes from "../../core/agent-session.types.ts";
import type programStatusReporterTypes from "./program-status-reporter.types.ts";

const { APP_NAME } = config;

function firstLine(text: string | undefined): string {
  return text?.split(/\r?\n/u, 1)[0]?.trim() || "Error";
}

export default class ProgramStatusReporter {
  private readonly getTerminal: () => tuiTypes.Terminal;
  private readonly getSessionName: () => string | undefined;
  private runActive = false;
  private compacting = false;
  private runResult: tuiTypes.ProgramStatus = { state: "done" };
  private restingStatus: tuiTypes.ProgramStatus = { state: "idle" };
  private readonly blocked = new Map<string, programStatusReporterTypes.BlockedStatus>();
  private lastReport: string | undefined;

  constructor(getTerminal: () => tuiTypes.Terminal, getSessionName: () => string | undefined) {
    this.getTerminal = getTerminal;
    this.getSessionName = getSessionName;
  }

  handleEvent(event: agentSessionTypes.AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.runActive = true;
        this.runResult = { state: "done" };
        break;
      case "message_end":
        if (event.message.role !== "assistant") return;
        this.runResult =
          event.message.stopReason === "error"
            ? { message: firstLine(event.message.errorMessage), state: "error" }
            : { state: "done" };
        break;
      case "compaction_start":
        this.compacting = true;
        break;
      case "compaction_end":
        this.compacting = false;
        if (this.runActive) {
          if (event.aborted) this.runResult = { state: "idle" };
          else if (event.errorMessage !== undefined && event.errorMessage !== "")
            this.runResult = { message: firstLine(event.errorMessage), state: "error" };
        } else if (event.aborted) {
          this.restingStatus = { state: "idle" };
        } else if (event.reason === "manual") {
          this.restingStatus =
            event.errorMessage !== undefined && event.errorMessage !== ""
              ? { message: firstLine(event.errorMessage), state: "error" }
              : { state: "done" };
        }
        break;
      case "agent_settled":
        this.runActive = false;
        this.restingStatus = event.aborted ? { state: "idle" } : this.runResult;
        break;
      case "session_info_changed":
        break;
      default:
        return;
    }
    this.report();
  }

  setBlocked(source: string, status: programStatusReporterTypes.BlockedStatus | undefined): void {
    this.blocked.delete(source);
    if (status !== undefined) this.blocked.set(source, status);
    this.report();
  }

  reset(): void {
    this.runActive = false;
    this.compacting = false;
    this.runResult = { state: "done" };
    this.restingStatus = { state: "idle" };
    this.report();
  }

  report(): void {
    const status: tuiTypes.ProgramStatus = { ...this.currentStatus(), app: APP_NAME };
    const key = JSON.stringify(status);
    if (key === this.lastReport) return;
    this.lastReport = key;
    this.getTerminal().setProgramStatus(status);
  }

  private currentStatus(): tuiTypes.ProgramStatus {
    const blocked = [...this.blocked.values()].at(-1);
    if (blocked !== undefined) return { state: "blocked", ...blocked };
    if (this.compacting) return { message: "Compacting context", state: "working" };
    const status = this.runActive ? { state: "working" as const } : this.restingStatus;
    if (status.state === "working" || status.state === "done") {
      const message = this.getSessionName();
      return { ...status, ...(message === undefined ? {} : { message }) };
    }
    return status;
  }
}
