import type chordTypes from "../../src/index.types.ts";
import type AckGateClass from "./ack-gate.ts";

declare namespace flowTypes {
  interface FlowClient {
    readonly host: chordTypes.Host;
    readonly gate: AckGate;
  }

  type AckGate = (typeof AckGateClass)["prototype"];
}

export type { flowTypes as default };
