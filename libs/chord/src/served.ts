import type connectionTypesModule from "./connection-types.types.ts";
import type connectionTypes from "./connection.types.ts";
import RefImpl from "./ref.ts";
import type refTypes from "./ref.types.ts";
import schemaModule from "./schema.ts";
import servedKit from "./served-kit.ts";
import serviceModule from "./service.ts";
import type typesModule from "./types.types.ts";
import wire from "./wire.ts";
import type wireTypes from "./wire.types.ts";

const { contract: contractModule, delta, errors: errorsModule } = servedKit;

const { variantOf } = serviceModule;
const { LOCAL_VARIANT, contractFromDescription, resolveHost } = contractModule;
const { assertValid } = schemaModule;
const { ChordError, invalid, isChordError } = errorsModule;
const { toWireError } = wire;

const { encoder } = delta;

const validateSnapshot = (ref: refTypes.RefImpl, member: string, value: unknown): void => {
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
  isChordError(error, "contract_mismatch")
    ? ChordError.create("upgrade_required", error.message, { cause: error })
    : error;

type HoldFrame = Extract<wireTypes.Frame, { t: "hold" }>;

export default class ServedHolds {
  readonly #connection: connectionTypes.Connection;

  constructor(connection: connectionTypes.Connection) {
    this.#connection = connection;
  }

  hold(frame: HoldFrame, principal: unknown, origin: string | undefined): void {
    const connection = this.#connection;
    const client = origin !== undefined;
    let ref: refTypes.RefImpl;
    try {
      ref = this.#acquire(frame, principal, client);
    } catch (error) {
      connection.send({
        error: toWireError(client ? clientError(error) : error),
        id: frame.id,
        t: "gone",
      });
      return;
    }
    const served: connectionTypesModule.ServedLocal = {
      again: frame.again === true,
      feeds: new Map(),
      id: frame.id,
      kind: "local",
      origin,
      principal,
      ref,
      unitSent: false,
      wantsState: frame.state !== false,
    };
    connection.served.set(frame.id, served);
    ref.onShape(() => this.#unit(served));
    ref.goneListeners.add((error) => {
      if (connection.served.get(frame.id) !== served) return;
      this.drop(frame.id, false);
      connection.send({ error: toWireError(error), id: frame.id, t: "gone" });
    });
    if (ref.status === "live") this.#unit(served);
  }

  #acquire(frame: HoldFrame, principal: unknown, client: boolean): refTypes.RefImpl {
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
      throw ChordError.create("unavailable", "not a local reference");
    return acquired;
  }

  #stateMembers(ref: refTypes.RefImpl, shape: typesModule.Shape): string[] {
    return shape.members.filter((name) => ref.describe(shape.variant, name)?.kind === "state");
  }

  #unit(served: connectionTypesModule.ServedLocal): void {
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

  #sendUnit(served: connectionTypesModule.ServedLocal): void {
    const connection = this.#connection;
    connection.flow.unitSent(served.id);
    if (connection.served.get(served.id) !== served) return;
    const shape = served.ref.shape;
    if (shape === undefined) return;
    served.unitSent = true;
    const members = served.wantsState ? this.#stateMembers(served.ref, shape) : [];
    const listed = members.filter((name) => !served.feeds.has(name));
    const snaps: connectionTypesModule.StateFrame[] = [];
    const attached: (readonly [string, connectionTypesModule.Feed])[] = [];
    for (const name of listed) {
      const attachment = this.#attach(served, name);
      if (attachment === undefined) continue;
      snaps.push(attachment.frame);
      attached.push([name, attachment.feed]);
    }
    connection.send({
      contract: shape.contract,
      id: served.id,
      members: shape.members,
      state: snaps.map((frame) => frame.m),
      t: "shape",
      ...(shape.variant === undefined ? {} : { variant: shape.variant }),
    });
    for (const frame of snaps) connection.send(frame);
    for (const [name, feed] of attached) this.#replay(served, name, feed);
  }

  #attach(
    served: connectionTypesModule.ServedLocal,
    name: string,
    as: "snap" | "reset" = "snap",
  ):
    | {
        readonly frame: connectionTypesModule.StateFrame;
        readonly feed: connectionTypesModule.Feed;
      }
    | undefined {
    const readable = served.ref.member(name) as typesModule.Readable<unknown> | undefined;
    if (readable === undefined || typeof readable.events !== "function") return undefined;
    const feed: connectionTypesModule.Feed = {
      buffer: [],
      encoder: encoder(),
      unsubscribe: () => {},
    };
    let first: typesModule.StateEvent<unknown> | undefined;
    feed.unsubscribe = readable.events((event) => {
      if (first === undefined) first = event;
      else if (feed.buffer === undefined) this.#feedEvent(served, name, feed, event);
      else feed.buffer.push(event);
    });
    served.feeds.set(name, feed);
    return { feed, frame: this.#snapshot(served, name, as, first?.value) };
  }

  #replay(
    served: connectionTypesModule.ServedLocal,
    name: string,
    feed: connectionTypesModule.Feed,
  ): void {
    const buffered = feed.buffer ?? [];
    feed.buffer = undefined;
    for (const event of buffered) this.#feedEvent(served, name, feed, event);
  }

  #snapshot(
    served: connectionTypesModule.ServedLocal,
    name: string,
    as: "snap" | "reset",
    value: unknown,
  ): connectionTypesModule.StateFrame {
    try {
      validateSnapshot(served.ref, name, value);
    } catch (error) {
      return { as: "error", error: toWireError(error), hold: served.id, m: name, t: "state" };
    }
    return { as, hold: served.id, m: name, t: "state", ...(value === undefined ? {} : { value }) };
  }

  #feedEvent(
    served: connectionTypesModule.ServedLocal,
    name: string,
    feed: connectionTypesModule.Feed,
    event: typesModule.StateEvent<unknown>,
  ): void {
    if (served.feeds.get(name) !== feed) return;
    const flow = this.#connection.flow;
    const overflow = { resend: () => this.#resend(served, name) };
    if (event.type === "ops") {
      flow.sendState(
        { as: "ops", hold: served.id, m: name, ops: feed.encoder.encode(event.ops), t: "state" },
        overflow,
      );
      return;
    }
    feed.encoder = encoder();
    flow.sendState(this.#snapshot(served, name, "reset", event.value), overflow);
  }

  #resend(served: connectionTypesModule.ServedLocal, name: string): void {
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
      served.relay.close(ChordError.create("released", "relayed hold released"), {
        notify: false,
        releaseDown: release,
      });
      return;
    }
    for (const feed of served.feeds.values()) feed.unsubscribe();
    served.feeds.clear();
    connection.flow.dropHoldState(id);
    if (release) served.ref.release();
  }
}
