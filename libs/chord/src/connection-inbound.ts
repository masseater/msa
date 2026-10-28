import { Cause, Effect } from "effect";

import connectionInboundKit from "./connection-inbound-kit.ts";
import type connectionTypesModule from "./connection-types.types.ts";
import type connectionTypes from "./connection.types.ts";
import type ctxTypes from "./ctx.types.ts";
import relayCallModule from "./relay-call.ts";
import RelayRef from "./relay.ts";
import type typesModule from "./types.types.ts";
import wire from "./wire.ts";
import type wireTypes from "./wire.types.ts";

const { errors: errorsModule, link } = connectionInboundKit;

const { PROTOCOL_VERSION, fromWireError, toWireError } = wire;
const { ChordError } = errorsModule;

const { Packed, unpack } = link;
const { relayCall } = relayCallModule;

type CallFrame = Extract<wireTypes.Frame, { t: "call" }>;

export default class Inbound {
  readonly #connection: connectionTypes.Connection;

  constructor(connection: connectionTypes.Connection) {
    this.#connection = connection;
  }

  hello(frame: Extract<wireTypes.Frame, { t: "hello" }>): void {
    const connection = this.#connection;
    if ((frame.protocol ?? 1) !== PROTOCOL_VERSION) {
      connection.protocolMismatch(frame.protocol ?? 1);
      return;
    }
    connection.flow.peerAcks(frame.acks === true);
    if (connection.role === "upstream") {
      if (frame.kind !== "host") {
        connection.violation("parent is not a host");
        return;
      }
      connection.parentName ??= frame.name;
      return;
    }
    const peer = connection.peer;
    if (frame.kind !== peer.kind || (peer.name !== undefined && frame.name !== peer.name)) {
      connection.violation(
        `hello ${frame.kind} ${frame.name} does not match the accepted ${peer.kind} ${peer.name ?? ""}`,
      );
      return;
    }
    if (peer.kind === "host") connection.host.peerHello(connection, frame.codeVersion);
  }

  hold(frame: Extract<wireTypes.Frame, { t: "hold" }>): void {
    const connection = this.#connection;
    if (connection.served.has(frame.id)) {
      connection.violation(`duplicate hold id ${frame.id}`);
      return;
    }
    const downstream = connection.role === "downstream";
    const principal = downstream ? connection.principal : (frame.principal ?? connection.principal);
    const origin = downstream ? connection.originId : frame.origin;
    if (frame.at === connection.host.name) {
      connection.holds.hold(frame, principal, origin);
      return;
    }
    if (!downstream) {
      connection.send({
        error: toWireError(
          ChordError.create("unavailable", `${connection.host.name} does not relay`),
        ),
        id: frame.id,
        t: "gone",
      });
      return;
    }
    const relay = new RelayRef(connection, frame, principal, origin);
    connection.served.set(frame.id, { kind: "relay", relay });
    Effect.runFork(
      connection.host
        .relay(relay)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              relay.close(Cause.squash(cause), { notify: true, releaseDown: true }),
            ),
          ),
        ),
    );
  }

  call(frame: CallFrame): void {
    const connection = this.#connection;
    if (connection.incoming.has(frame.id)) {
      connection.violation(`duplicate call id ${frame.id}`);
      return;
    }
    if (connection.incoming.size >= connection.maxCalls) {
      const error = ChordError.create(
        "unavailable",
        `Too many calls in progress on this connection (${connection.maxCalls}); wait for earlier ones to finish`,
        { reason: "too_many_calls" },
      );
      connection.send({ error: toWireError(error), id: frame.id, t: "result" });
      return;
    }
    const served = connection.served.get(frame.hold);
    if (served === undefined) {
      connection.send({
        error: toWireError(ChordError.create("gone", "unknown hold")),
        id: frame.id,
        t: "result",
      });
      return;
    }
    const controller = new AbortController();
    connection.incoming.set(frame.id, controller);
    const root = connection.peer.kind === "host" ? this.#admitRoot(frame.root) : undefined;
    const principal = served.kind === "local" ? served.principal : served.relay.principal;
    const options = { principal, signal: controller.signal };
    const run = this.#runner(served, frame);
    const host = connection.host;
    const result =
      root === undefined
        ? host.root(run, options)
        : host.joinRoot(root.rootId, root.codeVersion, run, { ...options, from: connection });
    result
      .then(
        (value) => connection.send({ id: frame.id, t: "result", value }),
        (error: unknown) =>
          connection.send({ error: toWireError(error), id: frame.id, t: "result" }),
      )
      .finally(() => connection.incoming.delete(frame.id));
  }

  #runner(
    served: connectionTypesModule.Served,
    frame: CallFrame,
  ): (ctx: typesModule.Ctx) => Promise<unknown> {
    const host = this.#connection.host;
    if (served.kind === "local")
      return (ctx) =>
        served.ref.object.calls.run(
          served.ref,
          frame.member,
          unpack(frame.args),
          ctx as ctxTypes.CtxImpl,
        );
    return (ctx) =>
      Effect.runPromise(
        relayCall({
          frame,
          relay: served.relay,
          root: { codeVersion: ctx.codeVersion, rootId: ctx.rootId },
          rootSent: (rootId, down) => host.rootSent(rootId, down),
          signal: ctx.signal,
        }),
      );
  }

  #admitRoot(root: wireTypes.RootRef | undefined): wireTypes.RootRef | undefined {
    const connection = this.#connection;
    if (
      root === undefined ||
      connection.role !== "downstream" ||
      !connection.fencedCodeVersions.has(root.codeVersion)
    )
      return root;
    if (connection.host.hasCodeVersion(root.codeVersion)) return root;
    let codeVersion = connection.admitted.get(root.rootId);
    if (codeVersion === undefined) {
      codeVersion = connection.host.current.id;
      connection.admitted.set(root.rootId, codeVersion);
    }
    return { codeVersion, rootId: root.rootId };
  }

  holdReply(frame: Extract<wireTypes.Frame, { t: "shape" | "gone" }>): void {
    const connection = this.#connection;
    const relay = connection.relayedRefs.get(frame.id);
    if (relay !== undefined) {
      if (frame.t === "gone")
        relay.close(fromWireError(frame.error), { notify: true, releaseDown: false });
      else relay.shape(frame);
      return;
    }
    const binding = connection.remotes.get(frame.id);
    if (binding === undefined) return;
    if (frame.t === "gone") {
      connection.remotes.delete(frame.id);
      binding.gone(fromWireError(frame.error));
      return;
    }
    binding.shaped(
      { contract: frame.contract, members: frame.members, variant: frame.variant },
      frame.state,
    );
  }

  result(frame: Extract<wireTypes.Frame, { t: "result" }>): void {
    const connection = this.#connection;
    const relayed = connection.relayedCalls.get(frame.id);
    if (relayed !== undefined) {
      relayed.finish(
        frame.error === undefined ? undefined : fromWireError(frame.error),
        frame.value,
      );
      return;
    }
    const pending = connection.calls.get(frame.id);
    connection.calls.delete(frame.id);
    if (frame.error !== undefined) {
      pending?.reject(fromWireError(frame.error));
      return;
    }
    let value: unknown;
    try {
      value = unpack(frame.value);
    } catch (error) {
      pending?.reject(error);
      return;
    }
    pending?.resolve(value);
  }

  state(frame: Extract<wireTypes.Frame, { t: "state" }>): void {
    const connection = this.#connection;
    const relay = connection.relayedRefs.get(frame.hold);
    if (relay !== undefined) {
      relay.state(frame);
      return;
    }
    const binding = connection.remotes.get(frame.hold);
    if (binding === undefined) return;
    if (!(frame.value instanceof Packed)) {
      binding.state(frame.m, frame);
      return;
    }
    let value: unknown;
    try {
      value = unpack(frame.value);
    } catch (error) {
      binding.state(frame.m, { as: "error", error: toWireError(error) });
      return;
    }
    binding.state(frame.m, { ...frame, value });
  }
}
