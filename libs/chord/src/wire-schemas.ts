import { type TSchema, Type } from "typebox";

import contractModule from "./contract.ts";
import errorsModule from "./errors.ts";

const { CHORD_ERROR_CODES } = errorsModule;
const { DescriptionSchema } = contractModule;

const PROTOCOL_VERSION = 4;

const Id = Type.Integer({ minimum: 1 });
const Name = Type.String({ minLength: 1 });
const Reload = Type.Integer({ minimum: 1 });
const List = <T extends TSchema>(item: T) => Type.Immutable(Type.Array(item));

const RootRefSchema = Type.Object({ codeVersion: Type.Integer({ minimum: 1 }), rootId: Name });

const WireErrorSchema = Type.Object({
  code: Type.Enum(CHORD_ERROR_CODES),
  message: Type.String(),
  reason: Type.Optional(Type.String()),
});

const WireReloadOptionsSchema = Type.Object({
  gateDeadline: Type.Optional(Type.Number()),
  remove: Type.Optional(List(Type.String())),
  retireDeadline: Type.Optional(Type.Number()),
});

const WireReloadReportSchema = Type.Object({
  changed: List(Type.String()),
  codeVersion: Type.Integer(),
  gated: List(Type.String()),
  prepared: List(Type.String()),
  previous: Type.Integer(),
  removed: List(Type.String()),
});

const FrameSchema = Type.Union([
  Type.Object({
    acks: Type.Optional(Type.Boolean()),
    codeVersion: Type.Integer({ minimum: 0 }),
    kind: Type.Union([Type.Literal("host"), Type.Literal("client")]),
    name: Name,
    protocol: Type.Optional(Type.Integer({ minimum: 1 })),
    t: Type.Literal("hello"),
  }),
  Type.Object({ n: Type.Integer({ minimum: 1 }), t: Type.Literal("ack") }),
  Type.Object({
    again: Type.Optional(Type.Literal(true)),
    at: Name,
    id: Id,
    input: Type.Unknown(),
    origin: Type.Optional(Name),
    principal: Type.Optional(Type.Unknown()),
    state: Type.Optional(Type.Literal(false)),
    t: Type.Literal("hold"),
    token: DescriptionSchema,
  }),
  Type.Object({ id: Id, t: Type.Literal("release") }),
  Type.Object({
    contract: Type.String(),
    id: Id,
    members: List(Type.String()),
    state: List(Name),
    t: Type.Literal("shape"),
    variant: Type.Optional(Type.String()),
  }),
  Type.Object({ error: WireErrorSchema, id: Id, t: Type.Literal("gone") }),
  Type.Object({
    args: Type.Optional(Type.Unknown()),
    hold: Id,
    id: Id,
    member: Name,
    root: Type.Optional(RootRefSchema),
    t: Type.Literal("call"),
  }),
  Type.Object({
    error: Type.Optional(WireErrorSchema),
    id: Id,
    t: Type.Literal("result"),
    value: Type.Optional(Type.Unknown()),
  }),
  Type.Object({ id: Id, t: Type.Literal("cancel") }),
  Type.Object({ hold: Id, t: Type.Literal("sub") }),
  Type.Object({ hold: Id, t: Type.Literal("unsub") }),
  Type.Object({ hold: Id, m: Name, t: Type.Literal("resync") }),
  Type.Object({
    as: Type.Union([
      Type.Literal("snap"),
      Type.Literal("reset"),
      Type.Literal("ops"),
      Type.Literal("error"),
    ]),
    error: Type.Optional(WireErrorSchema),
    hold: Id,
    m: Name,
    ops: Type.Optional(List(List(Type.Unknown()))),
    t: Type.Literal("state"),
    value: Type.Optional(Type.Unknown()),
  }),
  Type.Object({ n: Type.Integer(), t: Type.Literal("ping") }),
  Type.Object({ n: Type.Integer(), t: Type.Literal("pong") }),
  Type.Object({ reason: Type.Optional(Type.String()), t: Type.Literal("bye") }),
  Type.Object({ rootId: Name, t: Type.Literal("root_end") }),
  Type.Object({
    pattern: Type.Record(Type.String(), Type.Unknown()),
    t: Type.Literal("invalidate"),
  }),
  Type.Object({
    codeVersion: Type.Integer({ minimum: 1 }),
    options: WireReloadOptionsSchema,
    plugins: List(Type.String()),
    reload: Reload,
    t: Type.Literal("prepare"),
  }),
  Type.Object({
    error: Type.Optional(WireErrorSchema),
    reload: Reload,
    report: Type.Optional(WireReloadReportSchema),
    t: Type.Literal("vote"),
  }),
  Type.Object({ reload: Reload, t: Type.Literal("commit") }),
  Type.Object({ codeVersion: Type.Integer({ minimum: 1 }), t: Type.Literal("retire") }),
  Type.Object({ reload: Reload, t: Type.Literal("abort") }),
]);

const wireSchemas = {
  FrameSchema,
  PROTOCOL_VERSION,
  RootRefSchema,
  WireErrorSchema,
  WireReloadOptionsSchema,
  WireReloadReportSchema,
};

export default wireSchemas;
