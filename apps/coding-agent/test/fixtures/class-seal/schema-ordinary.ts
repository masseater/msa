import { Effect, Schema } from "effect";

const Name = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const input: unknown = JSON.parse('"x"');

Effect.runSync(Schema.decodeUnknownEffect(Schema.String)(input));
Schema.is(Name)("x");

export default class E extends Schema.TaggedError<E>()("E", {
  cause: Schema.NullOr(Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
  items: Schema.Array(Schema.String),
  name: Name,
  retry: Schema.optional(Schema.Boolean),
}) {}
