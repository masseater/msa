import type { BetaCacheControlEphemeral as CacheControlEphemeral } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

declare namespace anthropicMessagesToolsTypes {
  interface ConvertToolsOptions {
    supportsEagerToolInputStreaming: boolean;
    supportsStrictTools: boolean;
    cacheControl?: CacheControlEphemeral | undefined;
    disablePreferredStrictTools?: boolean | undefined;
  }
}

export type { anthropicMessagesToolsTypes as default };
