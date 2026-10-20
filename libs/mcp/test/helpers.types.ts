import type { Effect, Schema } from "effect";

declare namespace helpersTypes {
  type HttpHandler = (
    request: Request,
    origin: string,
  ) => Effect.Effect<Response, Schema.SchemaError>;
}

export type { helpersTypes as default };
