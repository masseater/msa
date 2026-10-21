import type connectionTypes from "./connection.types.ts";
import type relayCallModule from "./relay-call.ts";
import type relayTypes from "./relay.types.ts";
import type wireTypes from "./wire.types.ts";

declare namespace relayCallTypes {
  interface RelayRequest {
    readonly relay: relayTypes.RelayRef;
    readonly frame: Extract<wireTypes.Frame, { t: "call" }>;
    readonly root: wireTypes.RootRef;
    readonly signal: AbortSignal;
    readonly rootSent: (rootId: string, connection: connectionTypes.Connection) => void;
  }

  type RelayCall = (typeof relayCallModule.RelayCall)["prototype"];
}

export type { relayCallTypes as default };
