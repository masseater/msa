import type chordTypes from "../../src/index.types.ts";
import type flow from "./flow.ts";

declare namespace flowTypes {
  interface FlowClient {
    readonly host: chordTypes.Host;
    readonly gate: AckGate;
  }

  type AckGate = (typeof flow.AckGate)["prototype"];
}

export type { flowTypes as default };
