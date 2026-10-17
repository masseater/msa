import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

import { DescriptionSchema } from "./contract.ts";
import { CHORD_ERROR_CODES, ChordError } from "./errors.ts";

export const PROTOCOL_VERSION = 4;

const Id = Type.Integer({ minimum: 1 });
const Name = Type.String({ minLength: 1 });
const Reload = Type.Integer({ minimum: 1 });
const List = <T extends TSchema>(item: T) => Type.Immutable(Type.Array(item));

const RootRefSchema = Type.Object({ rootId: Name, codeVersion: Type.Integer({ minimum: 1 }) });
export type RootRef = Static<typeof RootRefSchema>;

const WireErrorSchema = Type.Object({
  code: Type.Enum(CHORD_ERROR_CODES),
  message: Type.String(),
  reason: Type.Optional(Type.String()),
});
export type WireError = Static<typeof WireErrorSchema>;

const WireReloadOptionsSchema = Type.Object({
  remove: Type.Optional(List(Type.String())),
  gateDeadline: Type.Optional(Type.Number()),
  retireDeadline: Type.Optional(Type.Number()),
});
export type WireReloadOptions = Static<typeof WireReloadOptionsSchema>;

const WireReloadReportSchema = Type.Object({
  codeVersion: Type.Integer(),
  previous: Type.Integer(),
  changed: List(Type.String()),
  removed: List(Type.String()),
  prepared: List(Type.String()),
  gated: List(Type.String()),
});
export type WireReloadReport = Static<typeof WireReloadReportSchema>;

const FrameSchema = Type.Union([
  Type.Object({
    t: Type.Literal("hello"),
    protocol: Type.Optional(Type.Integer({ minimum: 1 })),
    name: Name,
    kind: Type.Union([Type.Literal("host"), Type.Literal("client")]),
    codeVersion: Type.Integer({ minimum: 0 }),
    acks: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ t: Type.Literal("ack"), n: Type.Integer({ minimum: 1 }) }),
  Type.Object({
    t: Type.Literal("hold"),
    id: Id,
    at: Name,
    token: DescriptionSchema,
    input: Type.Unknown(),
    principal: Type.Optional(Type.Unknown()),
    origin: Type.Optional(Name),
    state: Type.Optional(Type.Literal(false)),
    again: Type.Optional(Type.Literal(true)),
  }),
  Type.Object({ t: Type.Literal("release"), id: Id }),
  Type.Object({
    t: Type.Literal("shape"),
    id: Id,
    variant: Type.Optional(Type.String()),
    members: List(Type.String()),
    contract: Type.String(),
    state: List(Name),
  }),
  Type.Object({ t: Type.Literal("gone"), id: Id, error: WireErrorSchema }),
  Type.Object({
    t: Type.Literal("call"),
    id: Id,
    hold: Id,
    member: Name,
    args: Type.Optional(Type.Unknown()),
    root: Type.Optional(RootRefSchema),
  }),
  Type.Object({
    t: Type.Literal("result"),
    id: Id,
    value: Type.Optional(Type.Unknown()),
    error: Type.Optional(WireErrorSchema),
  }),
  Type.Object({ t: Type.Literal("cancel"), id: Id }),
  Type.Object({ t: Type.Literal("sub"), hold: Id }),
  Type.Object({ t: Type.Literal("unsub"), hold: Id }),
  Type.Object({ t: Type.Literal("resync"), hold: Id, m: Name }),
  Type.Object({
    t: Type.Literal("state"),
    hold: Id,
    m: Name,
    as: Type.Union([
      Type.Literal("snap"),
      Type.Literal("reset"),
      Type.Literal("ops"),
      Type.Literal("error"),
    ]),
    value: Type.Optional(Type.Unknown()),
    ops: Type.Optional(List(List(Type.Unknown()))),
    error: Type.Optional(WireErrorSchema),
  }),
  Type.Object({ t: Type.Literal("ping"), n: Type.Integer() }),
  Type.Object({ t: Type.Literal("pong"), n: Type.Integer() }),
  Type.Object({ t: Type.Literal("bye"), reason: Type.Optional(Type.String()) }),
  Type.Object({ t: Type.Literal("root_end"), rootId: Name }),
  Type.Object({
    t: Type.Literal("invalidate"),
    pattern: Type.Record(Type.String(), Type.Unknown()),
  }),
  Type.Object({
    t: Type.Literal("prepare"),
    reload: Reload,
    codeVersion: Type.Integer({ minimum: 1 }),
    plugins: List(Type.String()),
    options: WireReloadOptionsSchema,
  }),
  Type.Object({
    t: Type.Literal("vote"),
    reload: Reload,
    error: Type.Optional(WireErrorSchema),
    report: Type.Optional(WireReloadReportSchema),
  }),
  Type.Object({ t: Type.Literal("commit"), reload: Reload }),
  Type.Object({ t: Type.Literal("retire"), codeVersion: Type.Integer({ minimum: 1 }) }),
  Type.Object({ t: Type.Literal("abort"), reload: Reload }),
]);
export type Frame = Static<typeof FrameSchema>;

export const isFrame = (value: unknown): value is Frame => Value.Check(FrameSchema, value);

export function toWireError(error: unknown): WireError {
  if (error instanceof ChordError) {
    return error.reason === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, reason: error.reason };
  }
  return { code: "unavailable", message: error instanceof Error ? error.message : String(error) };
}

export const fromWireError = (error: WireError): ChordError =>
  new ChordError(error.code, error.message.replace(/^[a-z_]+(\/[a-z_]+)?: /u, ""), {
    reason: error.reason,
  });
