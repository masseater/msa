import agentModule from "./agent.ts";
import inboxModule from "./inbox.ts";
import liveModule from "./live.ts";
import provider from "./provider.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { AgentDoc } = agentModule;
const { LiveDoc } = liveModule;
const { InboxDoc } = inboxModule;
const { ProviderDoc } = provider;
const { UsageDoc } = usageModule;

const MOUNTED = [
  AgentDoc,
  LiveDoc,
  InboxDoc,
  ProviderDoc,
  UsageDoc,
] as unknown as readonly typesModule.ConversationDocToken<typesModule.JsonObject>[];

const MOUNTED_KINDS: ReadonlySet<string> = new Set(MOUNTED.map((token) => token.definition.kind));

const viewMount = {
  MOUNTED,
  MOUNTED_KINDS,
};

export default viewMount;
