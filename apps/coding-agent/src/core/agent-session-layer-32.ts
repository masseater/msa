import type telemetryTypes from "@msa/telemetry/index.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer31 from "./agent-session-layer-31.ts";
import awaitingModule from "./awaiting.ts";
import type messagesTypes from "./messages.types.ts";
import platform from "./platform.ts";
import ghModule from "./pr-watch/gh.ts";
import PrWatch from "./pr-watch/service.ts";
import type serviceTypes from "./pr-watch/service.types.ts";
import sessionHost from "./pr-watch/session-host.ts";
const { makeGh } = ghModule;
const { createPrWatchHost } = sessionHost;
const { awaited, awaitingWith, performed } = awaitingModule;
const { nowMs } = platform;

export default abstract class AgentSessionLayer32 extends AgentSessionLayer31 {
  protected createPrWatch(telemetry: telemetryTypes.TelemetryContext): serviceTypes.PrWatch {
    return new PrWatch({
      defaultIntervalMs: () => this.settingsManager.getPrWatchIntervalMs(),
      gh: makeGh({ cwd: this.cwd }),
      host: createPrWatchHost({
        changed: () =>
          this.emit({ prWatch: this.prWatchInternal.snapshot(), type: "pr_watch_changed" }),
        sendMessage: (message, options) => {
          void this.sendCustomMessage(message, options);
        },
        telemetry,
        threadId: this.sessionManager.getSessionId(),
      }),
      statusIntervalMs: () => this.settingsManager.getPrWatchStatusIntervalMs(),
    });
  }

  sendCustomMessage<T = unknown>(
    message: Pick<messagesTypes.CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const appMessage = {
          content: message.content ?? [],
          customType: message.customType,
          details: message.details,
          display: message.display,
          role: "custom" as const,
          timestamp: nowMs(),
        } satisfies messagesTypes.CustomMessage<T>;
        if (options?.deliverAs === "nextTurn") {
          this.pendingNextTurnMessages.push(appMessage);
        } else if (this.isStreaming && options?.triggerTurn !== false) {
          if (options?.deliverAs === "followUp") {
            this.agent.followUp(appMessage);
          } else {
            this.agent.steer(appMessage);
          }
        } else if (options?.triggerTurn === true) {
          if (this.isEmittingAgentSettled) {
            this.deferredSettledActions.push(() =>
              Effect.runPromise(
                awaitingWith(function* () {
                  return yield* awaited(this.sendCustomMessage(message, options));
                }, this),
              ),
            );
            return;
          }
          yield* performed(this.startRun({ message: appMessage, messageType: "custom" }));
        } else if (this.isStreaming) {
          this.pendingCustomMessages.push(appMessage);
        } else {
          this.appendCustomMessage(appMessage);
        }
      }, this),
    );
  }
}
