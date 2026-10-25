import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import actionsModule from "./actions.ts";
import handoffModule from "./handoff.ts";
import OrchestratorState from "./orchestrator-state.ts";
import type orchestratorTypes from "./orchestrator.types.ts";
import pullRequestsModule from "./pull-requests.ts";
import replanModule from "./replan.ts";
import storeModule from "./store.ts";
import TranscriptCache from "./transcripts.ts";

const { handoffs } = handoffModule;
const { store } = storeModule;
const { actions } = actionsModule;
const { replan } = replanModule;
const { pullRequests } = pullRequestsModule;

export default class Orchestrator {
  private readonly state: OrchestratorState;
  private readonly transcripts: TranscriptCache;

  constructor(options: orchestratorTypes.OrchestratorOptions) {
    this.state = new OrchestratorState(options);
    this.transcripts = new TranscriptCache(() => {
      for (const listener of this.state.listeners) listener();
    });
  }

  get database(): OrchestratorState["database"] {
    return this.state.database;
  }

  get snapshot(): orchestratorTypes.OrchestratorSnapshot {
    return this.state.snapshot;
  }

  get replanning(): boolean {
    return this.state.replanning;
  }

  get tasks(): readonly orchestratorTypes.TaskView[] {
    return this.state.snapshot.tasks;
  }

  onChange(listener: () => void): () => void {
    this.state.listeners.add(listener);
    return () => {
      this.state.listeners.delete(listener);
    };
  }

  messages(id: string): readonly agentTypes.AgentMessage[] {
    const sessionFile = this.snapshot.threads.find((thread) => thread.id === id)?.sessionFile;
    return this.transcripts.messages(id, this.state.workers, sessionFile ?? null);
  }

  progress(id: string): { startedAt: number | undefined; retrying: boolean } {
    return {
      retrying: this.state.workers.get(id)?.run.retry.isRetrying ?? false,
      startedAt: this.state.runs.has(id) ? this.state.runStartedAt.get(id) : undefined,
    };
  }

  refresh(): Promise<void> {
    return this.state.exclusive(Effect.sync(() => this.state.publish()));
  }

  list(): Promise<orchestratorTypes.TaskView[]> {
    return this.refresh().then(() => [...this.snapshot.tasks]);
  }

  read(id: string): Promise<orchestratorTypes.TaskView> {
    return Effect.runPromise(pullRequests.refresh(this.state, id))
      .then(() => this.refresh())
      .then(() => {
        const found = this.snapshot.tasks.find((task) => task.id === id);
        if (found === undefined) throw new Error(`Unknown task: ${id}`);
        return found;
      });
  }

  createTask(input: orchestratorTypes.CreateTaskInput): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(actions.createTask(this.state, input));
  }

  setDepends(input: orchestratorTypes.SetTaskDependsInput): Promise<orchestratorTypes.TaskView[]> {
    return this.state.exclusive(actions.setDepends(this.state, input));
  }

  setState(input: orchestratorTypes.SetTaskStateInput): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(actions.setState(this.state, input));
  }

  setModel(
    taskId: string,
    model: string,
    thinkingLevel?: orchestratorTypes.TaskView["thinkingLevel"],
  ): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(
      actions.setModel(this.state, taskId, model, thinkingLevel ?? undefined),
    );
  }

  sendNote(input: orchestratorTypes.SendNoteInput): Promise<orchestratorTypes.NoteDelivery> {
    return this.state.exclusive(actions.sendNote(this.state, input));
  }

  sendMessage(taskId: string, message: string): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(actions.sendMessage(this.state, taskId, message));
  }

  advise(taskId: string, question = ""): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(actions.advise(this.state, taskId, question));
  }

  stop(taskId: string): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(actions.stop(this.state, taskId));
  }

  rerun(taskId: string, extra = ""): Promise<orchestratorTypes.TaskView> {
    return this.state.exclusive(actions.rerun(this.state, taskId, extra));
  }

  mergePullRequest(number: number, head: string): Promise<string> {
    return Effect.runPromise(actions.mergePullRequest(this.state, number, head)).finally(() =>
      this.state.publish(),
    );
  }

  setMaxConcurrentThreads(value: number): Promise<number> {
    return this.state.exclusive(actions.setMaxConcurrent(this.state, value));
  }

  replan(input: orchestratorTypes.ReplanInput): Promise<orchestratorTypes.ReplanResult> {
    return replan(this.state, input).then((result) => {
      this.state.telemetry.replanned(input, result);
      return result;
    });
  }

  handoff(input: orchestratorTypes.HandoffInput): Promise<orchestratorTypes.HandoffResult> {
    return this.state.exclusive(handoffs.write(this.state, input));
  }

  searchReports(query: string, limit = 10): Promise<orchestratorTypes.ReportHit[]> {
    return this.state.exclusive(
      Effect.sync(() =>
        store.searchReports(this.state.database, this.state.options.project, query, limit),
      ),
    );
  }

  dispose(): Promise<void> {
    return this.state.dispose();
  }
}
