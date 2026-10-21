import type ReplicatedStatePublisherClass from "./state-publisher.ts";

declare namespace statePublisherTypes {
  type ReplicatedStatePublisher<T> = ReplicatedStatePublisherClass<T>;
}

export type { statePublisherTypes as default };
