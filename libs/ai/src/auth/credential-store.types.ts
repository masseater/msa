import type { Effect } from "effect";

import type credentialStore from "./credential-store.ts";

declare namespace credentialStoreTypes {
  interface SerialTask<K, A> {
    readonly chains: Map<K, Promise<unknown>>;
    readonly key: K;
    readonly task: Effect.Effect<A>;
  }

  type InMemoryCredentialStore = (typeof credentialStore.InMemoryCredentialStore)["prototype"];
}

export type { credentialStoreTypes as default };
