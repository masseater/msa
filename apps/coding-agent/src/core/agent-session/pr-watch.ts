import type telemetryTypes from "@msa/telemetry/index.types";

import type AgentSession from "../agent-session.ts";
import ghModule from "../pr-watch/gh.ts";
import PrWatch from "../pr-watch/service.ts";
import type serviceTypes from "../pr-watch/service.types.ts";
import sessionHost from "../pr-watch/session-host.ts";

const { makeGh } = ghModule;
const { createPrWatchHost } = sessionHost;

export default class SessionPrWatch {
  prWatchInternal!: serviceTypes.PrWatch;

  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get prWatch(): serviceTypes.PrWatchSnapshot {
    return this.prWatchInternal.snapshot();
  }

  start(telemetry: telemetryTypes.TelemetryContext): void {
    const { session } = this;
    this.prWatchInternal = new PrWatch({
      defaultIntervalMs: () => session.settingsManager.getPrWatchIntervalMs(),
      gh: makeGh({ cwd: session.cwd }),
      host: createPrWatchHost({
        changed: () =>
          session.emit({ prWatch: this.prWatchInternal.snapshot(), type: "pr_watch_changed" }),
        sendMessage: (message, options) => {
          void session.run.prompting.sendCustomMessage(message, options);
        },
        telemetry,
        threadId: session.sessionManager.getSessionId(),
      }),
      statusIntervalMs: () => session.settingsManager.getPrWatchStatusIntervalMs(),
    });
  }

  close(): Promise<void> {
    return Promise.resolve(this.prWatchInternal.dispose()).catch(() => undefined);
  }
}
