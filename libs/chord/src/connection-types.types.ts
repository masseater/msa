import type deltaTypes from "./delta/index.types.ts";
import type linkBaseTypes from "./link-base.types.ts";
import type refTypes from "./ref.types.ts";
import type relayCallTypes from "./relay-call.types.ts";
import type relayTypes from "./relay.types.ts";
import type typesModule from "./types.types.ts";
import type wireTypes from "./wire.types.ts";

declare namespace connectionTypesModule {
  interface LinkOptions {
    readonly pingInterval?: number;
    readonly pingTimeout?: number;
    readonly window?: number;
    readonly pendingCap?: number;
    readonly onProtocolMismatch?: (versions: {
      readonly local: number;
      readonly peer: number | undefined;
    }) => void;
  }

  interface AcceptOptions<P = unknown> extends LinkOptions {
    readonly principal: P;
    readonly kind?: "host" | "client";
    readonly name?: string;
    restamp?(principal: P): P | undefined;
    readonly maxCalls?: number;
  }

  interface Peer {
    readonly kind: "host" | "client";
    readonly name: string | undefined;
  }

  type ConnectionConfig = {
    readonly role: "upstream" | "downstream";
    readonly principal: unknown;
    readonly peer: Peer;
    readonly originId?: string;
    readonly restamp?: (principal: unknown) => unknown | undefined;
    readonly maxCalls?: number;
  } & LinkOptions;

  type StateFrame = Extract<wireTypes.Frame, { t: "state" }>;

  type Overflow = { readonly resend: () => void } | { readonly resync: () => void };

  interface Pending {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: unknown) => void;
  }

  interface Feed {
    unsubscribe: () => void;
    encoder: deltaTypes.Encoder;
    buffer: typesModule.StateEvent<unknown>[] | undefined;
  }

  interface ServedLocal {
    readonly kind: "local";
    readonly id: number;
    readonly ref: refTypes.RefImpl;
    readonly principal: unknown;
    readonly origin: string | undefined;
    wantsState: boolean;
    readonly again: boolean;
    unitSent: boolean;
    readonly feeds: Map<string, Feed>;
  }

  type Served = ServedLocal | { readonly kind: "relay"; readonly relay: relayTypes.RelayRef };

  type Link = linkBaseTypes.Link;

  type RelayCall = relayCallTypes.RelayCall;

  type RelayRef = relayTypes.RelayRef;
}

export type { connectionTypesModule as default };
