import type { Effect, Schema } from "effect";

declare namespace httpFixtureTypes {
  interface RecordedRequest {
    method: string;
    headers: Record<string, string>;
    message?: Record<string, unknown>;
  }

  type FixtureEffect = Effect.Effect<Response, Schema.SchemaError>;

  type FixtureHandler = (request: Request, requests: RecordedRequest[]) => FixtureEffect;
}

export type { httpFixtureTypes as default };
