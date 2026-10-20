import type { AssistantMessage, Message, SimpleStreamOptions } from "@msa/ai";
import type durableTypes from "@msa/durable/index.types";

import type supportTypes from "./support.types.ts";

declare namespace harnessCompactionSupportTypes {
  type Request = {
    readonly messages: readonly Message[];
    readonly options: SimpleStreamOptions | undefined;
    readonly model: string;
  };

  type Step =
    | AssistantMessage
    | ((request: Request) => AssistantMessage | Promise<AssistantMessage>);

  type Script = {
    readonly agent: Step[];
    readonly summaries: Step[];
    readonly agentRequests: Request[];
    readonly summaryRequests: Request[];
  };

  type Chat = {
    readonly harness: durableTypes.Harness;
    readonly root: durableTypes.Conversation;
    readonly setup: supportTypes.ChatSetup;
    readonly faux: Script;
  };
}

export type { harnessCompactionSupportTypes as default };
