import type { Encoder } from "./delta/index.ts";
import type { RefImpl } from "./ref.ts";
import type { RelayRef } from "./relay.ts";
import type { StateEvent } from "./types.ts";
import type { Frame } from "./wire.ts";

export interface LinkOptions {
  readonly pingInterval?: number;
  readonly pingTimeout?: number;
  readonly window?: number;
  readonly pendingCap?: number;
  readonly onProtocolMismatch?: (versions: {
    readonly local: number;
    readonly peer: number | undefined;
  }) => void;
}

export interface AcceptOptions<P = unknown> extends LinkOptions {
  readonly principal: P;
  readonly kind?: "host" | "client";
  readonly name?: string;
  restamp?(principal: P): P | undefined;
  readonly maxCalls?: number;
}

export interface Peer {
  readonly kind: "host" | "client";
  readonly name: string | undefined;
}

export type ConnectionConfig = {
  readonly role: "upstream" | "downstream";
  readonly principal: unknown;
  readonly peer: Peer;
  readonly originId?: string;
  readonly restamp?: (principal: unknown) => unknown | undefined;
  readonly maxCalls?: number;
} & LinkOptions;

export type StateFrame = Extract<Frame, { t: "state" }>;

export type Overflow = { readonly resend: () => void } | { readonly resync: () => void };

export interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

export interface Feed {
  unsubscribe: () => void;
  encoder: Encoder;
  buffer: StateEvent<unknown>[] | undefined;
}

export interface ServedLocal {
  readonly kind: "local";
  readonly id: number;
  readonly ref: RefImpl;
  readonly principal: unknown;
  readonly origin: string | undefined;
  wantsState: boolean;
  readonly again: boolean;
  unitSent: boolean;
  readonly feeds: Map<string, Feed>;
}

export type Served = ServedLocal | { readonly kind: "relay"; readonly relay: RelayRef };

export type { RelayCall } from "./relay-call.ts";
export type { RelayRef } from "./relay.ts";
export type { Link } from "./link.ts";
