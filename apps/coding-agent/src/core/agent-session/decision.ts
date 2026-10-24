import type aiTypes from "@msa/ai/index.types";
import localModule from "@msa/ai/providers/local";
import { Effect } from "effect";

import type AgentSession from "../agent-session.ts";
import Decide from "../decision/decide-service.ts";
import decideModule from "../decision/decide.ts";
import type decideTypes from "../decision/decide.types.ts";

const { LIQUID_D1 } = localModule;
const { makeDecide } = decideModule;

const DECISION_ENTRY = "decision";
const DECISION_MODEL_ENTRY = "decision_model";
const PROGRESS_STEPS = 10;

function progressLogger(
  append: (event: aiTypes.ClassifierModelEvent) => void,
): (event: aiTypes.ClassifierModelEvent) => void {
  let lastStep = -1;
  return (event) => {
    if (event.type === "download-progress") {
      const step =
        event.totalBytes > 0
          ? Math.floor((event.downloadedBytes / event.totalBytes) * PROGRESS_STEPS)
          : 0;
      if (step <= lastStep) return;
      lastStep = step;
    } else {
      lastStep = -1;
    }
    append(event);
  };
}

export default class SessionDecision {
  private service: decideTypes.DecideShape | undefined;

  private readonly session: AgentSession;

  private closed = false;

  constructor(session: AgentSession) {
    this.session = session;
  }

  start(): void {
    const { session } = this;
    const settings = session.settingsManager.models;
    const runtime = () => session.models.selection.modelRuntimeInternal;
    const onModelEvent = progressLogger((event) => {
      if (!this.closed) session.sessionManager.appendCustomEntry(DECISION_MODEL_ENTRY, event);
    });
    this.service = Effect.runSync(
      makeDecide({
        classify: (model, context, signal) =>
          runtime().classify(model, context, { onModelEvent, signal }),
        model: () => {
          const reference = settings.getDecisionModel() ?? `${LIQUID_D1.provider}/${LIQUID_D1.id}`;
          const slash = reference.indexOf("/");
          const model =
            slash > 0
              ? runtime().getModelOfType(
                  "classifier",
                  reference.slice(0, slash),
                  reference.slice(slash + 1),
                )
              : undefined;
          return model === undefined
            ? { unavailable: `decision.model "${reference}" is not an available classifier` }
            : { model };
        },
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

  close(): void {
    this.closed = true;
  }
}
