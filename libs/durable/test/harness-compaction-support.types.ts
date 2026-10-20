import type aiTypes from "@msa/ai/index.types";
import type durableTypes from "@msa/durable/index.types";

import type supportTypes from "./support.types.ts";

declare namespace harnessCompactionSupportTypes {
  type Request = {
    readonly messages: readonly aiTypes.Message[];
    readonly options: aiTypes.SimpleStreamOptions | undefined;
    readonly model: string;
  };

  type Step =
    | aiTypes.AssistantMessage
    | ((request: Request) => aiTypes.AssistantMessage | Promise<aiTypes.AssistantMessage>);

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
