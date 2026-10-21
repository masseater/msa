import type { Effect, Schema } from "effect";

declare namespace httpServerTypes {
  type HttpHandler = (
    request: Request,
    origin: string,
  ) => Effect.Effect<Response, Schema.SchemaError>;
}

export type { httpServerTypes as default };
