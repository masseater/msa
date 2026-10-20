import type { ClientOptions } from "@anthropic-ai/sdk";

import type typesModule from "../types.types.ts";

declare namespace anthropicMessagesClientTypes {
  interface AssertRequestAuthInput {
    readonly provider: string;
    readonly apiKey: string | undefined;
    readonly headers: typesModule.ProviderHeaders | undefined;
  }

  interface AnthropicFederationInput {
    readonly model: typesModule.Model<"anthropic-messages">;
    readonly apiKey: string | undefined;
    readonly headers: typesModule.ProviderHeaders | undefined;
    readonly env: typesModule.ProviderEnv | undefined;
  }

  type AnthropicFederationConfig = NonNullable<ClientOptions["config"]>;

  interface CreateClientInput {
    model: typesModule.Model<"anthropic-messages">;
    apiKey: string | undefined;
    optionsHeaders?: typesModule.ProviderHeaders | undefined;
    fetch?: typeof globalThis.fetch | undefined;
    sessionId?: string | undefined;
    federation?: AnthropicFederationConfig | undefined;
  }
}

export type { anthropicMessagesClientTypes as default };
