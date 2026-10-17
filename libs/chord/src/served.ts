import type { Feed, ServedLocal, StateFrame } from "./connection-types.ts";
import type { Connection } from "./connection.ts";
import { contractFromDescription, LOCAL_VARIANT, resolveHost } from "./contract.ts";
import { encoder } from "./delta/index.ts";
import { ChordError, invalid } from "./errors.ts";
import { RefImpl } from "./ref.ts";
import { assertValid } from "./schema.ts";
import { variantOf } from "./service.ts";
import type { Readable, Shape, StateEvent } from "./types.ts";
import { type Frame, toWireError } from "./wire.ts";

const validateSnapshot = (ref: RefImpl, member: string, value: unknown): void => {
  if (value === undefined) return;
  const installed = ref.object.currentInstalled();
  if (installed === undefined) return;
  const view = ref.currentView();
  const variant = view === undefined ? variantOf(installed.implementation) : variantOf(view);
  const description =
    view !== undefined && view !== installed.implementation
      ? ref.contract.description.variants[variant ?? LOCAL_VARIANT]?.[member]
      : installed.service.contract.description.variants[
          variantOf(installed.implementation) ?? LOCAL_VARIANT
        ]?.[member];
  if (description?.kind === "state")
    assertValid("state", `${ref.address}.${member}`, description.schema, value);
};

const clientError = (error: unknown): unknown =>
  error instanceof ChordError && error.code === "contract_mismatch"
    ? new ChordError("upgrade_required", error.message, { cause: error })
    : error;

type HoldFrame = Extract<Frame, { t: "hold" }>;

export class ServedHolds {
  readonly #connection: Connection;

  constructor(connection: Connection) {
    this.#connection = connection;
  }

  hold(frame: HoldFrame, principal: unknown, origin: string | undefined): void {
    const connection = this.#connection;
    const client = origin !== undefined;
    let ref: RefImpl;
    try {
      ref = this.#acquire(frame, principal, client);
    } catch (error) {
      connection.send({
        t: "gone",
        id: frame.id,
        error: toWireError(client ? clientError(error) : error),
      });
      return;
    }
    const served: ServedLocal = {
      kind: "local",
      id: frame.id,
      ref,
      principal,
      origin,
      wantsState: frame.state !== false,
      again: frame.again === true,
      unitSent: false,
      feeds: new Map(),
    };
    connection.served.set(frame.id, served);
    ref.onShape(() => this.#unit(served));
    ref.goneListeners.add((error) => {
      if (connection.served.get(frame.id) !== served) return;
      this.drop(frame.id, false);
      connection.send({ t: "gone", id: frame.id, error: toWireError(error) });
    });
    if (ref.status === "live") this.#unit(served);
  }

  #acquire(frame: HoldFrame, principal: unknown, client: boolean): RefImpl {
    const host = this.#connection.host;
    const token = contractFromDescription(frame.token);
    if (token.scope !== "remote")
      throw invalid("token", `${token.name} is local; only remote types cross links`);
    if (resolveHost(token.name, token.description.host!, frame.input) !== host.name)
      throw invalid("placement", `${token.name} with this input does not live on ${host.name}`);
    const acquired = host.acquire(
      token,
      frame.input,
      { principal },
      client ? "client" : "connection",
    );
    if (!(acquired instanceof RefImpl))
      throw new ChordError("unavailable", "not a local reference");
    return acquired;
  }

  #stateMembers(ref: RefImpl, shape: Shape): string[] {
    return shape.members.filter((name) => ref.describe(shape.variant, name)?.kind === "state");
  }

  #unit(served: ServedLocal): void {
    const connection = this.#connection;
    if (connection.served.get(served.id) !== served) return;
    const shape = served.ref.shape;
    if (shape === undefined) return;
    const members = new Set(served.wantsState ? this.#stateMembers(served.ref, shape) : []);
    for (const [name, feed] of served.feeds) {
      if (members.has(name)) continue;
      feed.unsubscribe();
      served.feeds.delete(name);
      connection.flow.dropState(served.id, name);
    }
    const urgent = served.feeds.size === 0 && !(served.again && !served.unitSent);
    if (urgent) this.#sendUnit(served);
    else connection.flow.queueUnit(served.id, () => this.#sendUnit(served));
  }

  #sendUnit(served: ServedLocal): void {
    const connection = this.#connection;
    connection.flow.unitSent(served.id);
    if (connection.served.get(served.id) !== served) return;
    const shape = served.ref.shape;
    if (shape === undefined) return;
    served.unitSent = true;
    const members = served.wantsState ? this.#stateMembers(served.ref, shape) : [];
    const listed = members.filter((name) => !served.feeds.has(name));
    const snaps: StateFrame[] = [];
    const attached: (readonly [string, Feed])[] = [];
    for (const name of listed) {
      const attachment = this.#attach(served, name);
      if (attachment === undefined) continue;
      snaps.push(attachment.frame);
      attached.push([name, attachment.feed]);
    }
    connection.send({
      t: "shape",
      id: served.id,
      ...(shape.variant === undefined ? {} : { variant: shape.variant }),
      members: shape.members,
      contract: shape.contract,
      state: snaps.map((frame) => frame.m),
    });
    for (const frame of snaps) connection.send(frame);
    for (const [name, feed] of attached) this.#replay(served, name, feed);
  }

  #attach(
    served: ServedLocal,
    name: string,
    as: "snap" | "reset" = "snap",
  ): { readonly frame: StateFrame; readonly feed: Feed } | undefined {
    const readable = served.ref.member(name) as Readable<unknown> | undefined;
    if (readable === undefined || typeof readable.events !== "function") return undefined;
    const feed: Feed = { unsubscribe: () => {}, encoder: encoder(), buffer: [] };
    let first: StateEvent<unknown> | undefined;
    feed.unsubscribe = readable.events((event) => {
      if (first === undefined) first = event;
      else if (feed.buffer === undefined) this.#feedEvent(served, name, feed, event);
      else feed.buffer.push(event);
    });
    served.feeds.set(name, feed);
    return { frame: this.#snapshot(served, name, as, first?.value), feed };
  }

  #replay(served: ServedLocal, name: string, feed: Feed): void {
    const buffered = feed.buffer ?? [];
    feed.buffer = undefined;
    for (const event of buffered) this.#feedEvent(served, name, feed, event);
  }

  #snapshot(served: ServedLocal, name: string, as: "snap" | "reset", value: unknown): StateFrame {
    try {
      validateSnapshot(served.ref, name, value);
    } catch (error) {
      return { t: "state", hold: served.id, m: name, as: "error", error: toWireError(error) };
    }
    return { t: "state", hold: served.id, m: name, as, ...(value === undefined ? {} : { value }) };
  }

  #feedEvent(served: ServedLocal, name: string, feed: Feed, event: StateEvent<unknown>): void {
    if (served.feeds.get(name) !== feed) return;
    const flow = this.#connection.flow;
    const overflow = { resend: () => this.#resend(served, name) };
    if (event.type === "ops") {
      flow.sendState(
        { t: "state", hold: served.id, m: name, as: "ops", ops: feed.encoder.encode(event.ops) },
        overflow,
      );
      return;
    }
    feed.encoder = encoder();
    flow.sendState(this.#snapshot(served, name, "reset", event.value), overflow);
  }

  #resend(served: ServedLocal, name: string): void {
    const feed = served.feeds.get(name);
    if (feed === undefined || this.#connection.served.get(served.id) !== served) return;
    feed.unsubscribe();
    served.feeds.delete(name);
    const attachment = this.#attach(served, name, "reset");
    if (attachment === undefined) return;
    this.#connection.send(attachment.frame);
    this.#replay(served, name, attachment.feed);
  }

  wantState(hold: number, wanted: boolean): void {
    const served = this.#connection.served.get(hold);
    if (served === undefined) return;
    if (served.kind === "relay") {
      served.relay.wantState(wanted);
      return;
    }
    if (served.wantsState === wanted) return;
    served.wantsState = wanted;
    if (wanted) {
      this.#unit(served);
      return;
    }
    for (const feed of served.feeds.values()) feed.unsubscribe();
    served.feeds.clear();
    this.#connection.flow.dropHoldState(hold);
  }

  resync(hold: number, m: string): void {
    const served = this.#connection.served.get(hold);
    if (served === undefined) return;
    if (served.kind === "relay") {
      served.relay.resync(m);
      return;
    }
    if (!served.feeds.has(m)) return;
    this.#connection.flow.resetLater(hold, m, () => this.#resend(served, m));
  }

  drop(id: number, release: boolean): void {
    const connection = this.#connection;
    const served = connection.served.get(id);
    if (served === undefined) return;
    connection.served.delete(id);
    if (served.kind === "relay") {
      served.relay.close(new ChordError("released", "relayed hold released"), {
        releaseDown: release,
        notify: false,
      });
      return;
    }
    for (const feed of served.feeds.values()) feed.unsubscribe();
    served.feeds.clear();
    connection.flow.dropHoldState(id);
    if (release) served.ref.release();
  }
}
