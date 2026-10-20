import type { TranscriptContext } from "@msa/ai";
import type { TSchema } from "typebox";

import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  StreamFn,
} from "../../src/types.ts";

declare namespace fixturesTypes {
  interface CallSpec {
    readonly id: string;
    readonly name?: string;
    readonly args?: AgentToolCall["arguments"];
  }

  interface Script {
    readonly streamFn: StreamFn;
    readonly calls: () => number;
    readonly contexts: TranscriptContext[];
  }

  interface EchoOptions<T extends TSchema> {
    readonly name?: string;
    readonly parameters?: T;
    readonly executionMode?: AgentTool["executionMode"];
    readonly run: AgentTool<T, any>["execute"];
  }

  interface Collected {
    readonly events: AgentEvent[];
    readonly messages: AgentMessage[];
  }
}

export type { fixturesTypes as default };
