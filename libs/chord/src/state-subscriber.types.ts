import type StateSubscriberClass from "./state-subscriber.ts";

declare namespace stateSubscriberTypes {
  type StateSubscriber<T> = StateSubscriberClass<T>;
}

export type { stateSubscriberTypes as default };
