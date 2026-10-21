import Inbound from "./connection-inbound.ts";
import type connectionInboundTypes from "./connection-inbound.types.ts";
import type connectionTypes from "./connection.types.ts";
import errorsModule from "./errors.ts";
import wire from "./wire.ts";
import type wireTypes from "./wire.types.ts";

const { ChordError } = errorsModule;
const { fromWireError } = wire;

type ControlFrame = Extract<
  wireTypes.Frame,
  { t: "invalidate" | "prepare" | "commit" | "abort" | "retire" }
>;

const CONTROL = new Set<wireTypes.Frame["t"]>([
  "invalidate",
  "prepare",
  "commit",
  "abort",
  "retire",
]);

const isControl = (frame: wireTypes.Frame): frame is ControlFrame => CONTROL.has(frame.t);

export default class FrameDispatch {
  readonly #connection: connectionTypes.Connection;
  readonly #inbound: connectionInboundTypes.Inbound;

  constructor(connection: connectionTypes.Connection) {
    this.#connection = connection;
    this.#inbound = new Inbound(connection);
  }

  frame(frame: wireTypes.Frame): void {
    const connection = this.#connection;
    switch (frame.t) {
      case "hello":
        this.#inbound.hello(frame);
        return;
      case "ping":
        connection.send({ n: frame.n, t: "pong" });
        break;
      case "pong":
      case "bye":
      case "ack":
        return;
      case "hold":
        this.#inbound.hold(frame);
        return;
      case "release":
        connection.holds.drop(frame.id, true);
        return;
      case "call":
        this.#inbound.call(frame);
        return;
      case "cancel":
        connection.incoming.get(frame.id)?.abort(new ChordError("aborted", "cancelled by caller"));
        return;
      default:
        this.#state(frame);
    }
  }

  #state(frame: wireTypes.Frame): void {
    const connection = this.#connection;
    switch (frame.t) {
      case "sub":
      case "unsub":
        connection.holds.wantState(frame.hold, frame.t === "sub");
        return;
      case "resync":
        connection.holds.resync(frame.hold, frame.m);
        return;
      case "shape":
      case "gone":
        this.#inbound.holdReply(frame);
        return;
      case "result":
        this.#inbound.result(frame);
        return;
      case "state":
        this.#inbound.state(frame);
        return;
      case "root_end":
        connection.admitted.delete(frame.rootId);
        connection.host.foreignRootEnded(frame.rootId, connection);
        return;
      default:
        if (isControl(frame)) this.#control(frame);
        else if (frame.t === "vote") this.#vote(frame);
    }
  }

  #control(frame: ControlFrame): void {
    const connection = this.#connection;
    if (connection.role !== "upstream") {
      connection.violation(`${frame.t} from a child`);
      return;
    }
    const host = connection.host;
    if (frame.t === "invalidate") {
      host.invalidatePrincipal(frame.pattern).catch((error: unknown) => host.report(error));
    } else if (frame.t === "retire") host.allowRetire(frame.codeVersion);
    else host.onReloadFrame(connection, frame);
  }

  #vote(frame: Extract<wireTypes.Frame, { t: "vote" }>): void {
    const connection = this.#connection;
    if (connection.role !== "downstream" || connection.peer.kind !== "host") {
      connection.violation("vote from a non-participant");
      return;
    }
    const vote = connection.votes.get(frame.reload);
    connection.votes.delete(frame.reload);
    if (frame.error === undefined) vote?.resolve(frame.report);
    else vote?.reject(fromWireError(frame.error));
  }
}
