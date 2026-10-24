import { Effect } from "effect";

import type AgentSession from "../agent-session.ts";
import Decide from "../decision/decide-service.ts";
import decideModule from "../decision/decide.ts";
import type decideTypes from "../decision/decide.types.ts";
import decisionModel from "../decision/decision-model.ts";

const { makeDecide } = decideModule;
const { resolveDecisionModel } = decisionModel;

const DECISION_ENTRY = "decision";

export default class SessionDecision {
  private service: decideTypes.DecideShape | undefined;

  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  start(): void {
    const { session } = this;
    const settings = session.settingsManager.models;
    const runtime = () => session.models.selection.modelRuntimeInternal;
    this.service = Effect.runSync(
      makeDecide({
        classify: (model, context, signal) => runtime().classify(model, context, { signal }),
        model: () => resolveDecisionModel(settings, runtime()),
        recordUndecided: (name, reason) => {
          session.sessionManager.appendCustomEntry(DECISION_ENTRY, {
            name,
            reason,
            status: "undecided",
          });
        },
        recordUsage: (result) => {
          if (result.usage === undefined) return;
          session.sessionManager.appendUsage(
            DECISION_ENTRY,
            result.provider,
            result.model,
            result.usage,
          );
        },
        threshold: (key) => settings.getDecisionThreshold(key),
      }),
    );
  }

  provide<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Decide>> {
    const { service } = this;
    if (service === undefined) return Effect.die(new Error("session decision has not started"));
    return Effect.provideService(effect, Decide, service);
  }
}
