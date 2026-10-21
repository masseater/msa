import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type typesModule from "../../src/types.ts";

declare namespace fixturesTypes {
  interface CallSpec {
    readonly id: string;
    readonly name?: string;
    readonly args?: typesModule.AgentToolCall["arguments"];
  }

  interface Script {
    readonly streamFn: typesModule.StreamFn;
    readonly calls: () => number;
    readonly contexts: aiTypes.TranscriptContext[];
  }

  interface EchoOptions<T extends TSchema> {
    readonly name?: string;
    readonly parameters?: T;
    readonly executionMode?: typesModule.AgentTool["executionMode"];
    readonly run: typesModule.AgentTool<T, any>["execute"];
  }

  interface Collected {
    readonly events: typesModule.AgentEvent[];
    readonly messages: typesModule.AgentMessage[];
  }
}

export type { fixturesTypes as default };
