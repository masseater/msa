import { Cause, Effect } from "effect";

import type { Served } from "./connection-types.ts";
import type { Connection } from "./connection.ts";
import type { CtxImpl } from "./ctx.ts";
import { ChordError } from "./errors.ts";
import { Packed, unpack } from "./link.ts";
import { relayCall } from "./relay-call.ts";
import { RelayRef } from "./relay.ts";
import type { Ctx } from "./types.ts";
import { type Frame, fromWireError, PROTOCOL_VERSION, type RootRef, toWireError } from "./wire.ts";

type CallFrame = Extract<Frame, { t: "call" }>;

export class Inbound {
  readonly #connection: Connection;

  constructor(connection: Connection) {
    this.#connection = connection;
  }

  hello(frame: Extract<Frame, { t: "hello" }>): void {
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

  hold(frame: Extract<Frame, { t: "hold" }>): void {
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
        t: "gone",
        id: frame.id,
        error: toWireError(new ChordError("unavailable", `${connection.host.name} does not relay`)),
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
              relay.close(Cause.squash(cause), { releaseDown: true, notify: true }),
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
      const error = new ChordError(
        "unavailable",
        `Too many calls in progress on this connection (${connection.maxCalls}); wait for earlier ones to finish`,
        { reason: "too_many_calls" },
      );
      connection.send({ t: "result", id: frame.id, error: toWireError(error) });
      return;
    }
    const served = connection.served.get(frame.hold);
    if (served === undefined) {
      connection.send({
        t: "result",
        id: frame.id,
        error: toWireError(new ChordError("gone", "unknown hold")),
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
        (value) => connection.send({ t: "result", id: frame.id, value }),
        (error: unknown) =>
          connection.send({ t: "result", id: frame.id, error: toWireError(error) }),
      )
      .finally(() => connection.incoming.delete(frame.id));
  }

  #runner(served: Served, frame: CallFrame): (ctx: Ctx) => Promise<unknown> {
    const host = this.#connection.host;
    if (served.kind === "local")
      return (ctx) =>
        served.ref.object.calls.run(served.ref, frame.member, unpack(frame.args), ctx as CtxImpl);
    return (ctx) =>
      Effect.runPromise(
        relayCall({
          relay: served.relay,
          frame,
          root: { rootId: ctx.rootId, codeVersion: ctx.codeVersion },
          signal: ctx.signal,
          rootSent: (rootId, down) => host.rootSent(rootId, down),
        }),
      );
  }

  #admitRoot(root: RootRef | undefined): RootRef | undefined {
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
    return { rootId: root.rootId, codeVersion };
  }

  holdReply(frame: Extract<Frame, { t: "shape" | "gone" }>): void {
    const connection = this.#connection;
    const relay = connection.relayedRefs.get(frame.id);
    if (relay !== undefined) {
      if (frame.t === "gone")
        relay.close(fromWireError(frame.error), { releaseDown: false, notify: true });
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
      { variant: frame.variant, members: frame.members, contract: frame.contract },
      frame.state,
    );
  }

  result(frame: Extract<Frame, { t: "result" }>): void {
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

  state(frame: Extract<Frame, { t: "state" }>): void {
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
