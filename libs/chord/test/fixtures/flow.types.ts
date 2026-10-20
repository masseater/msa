import type { Host } from "../../src/index.ts";
import type flow from "./flow.ts";

declare namespace flowTypes {
  interface FlowClient {
    readonly host: Host;
    readonly gate: AckGate;
  }

  type AckGate = (typeof flow.AckGate)["prototype"];
}

export type { flowTypes as default };
