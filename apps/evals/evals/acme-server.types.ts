import type { Effect } from "effect";

declare namespace acmeServerTypes {
  type AcmeServer = {
    start: Effect.Effect<void>;
    stop: Effect.Effect<void>;
    reset(): void;
    origin(): string;
    baseUrl(): string;
    validRequestReceived(): boolean;
  };
}

export type { acmeServerTypes as default };
