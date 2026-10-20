import BaseLink from "./link-base.ts";
import linkPack from "./link-pack.ts";
import type linkWebsocketTypes from "./link-websocket.types.ts";
import type wireTypes from "./wire.types.ts";

const { Packed, inflate, packMessage, parseFrame, splitMessage, zlibAvailable } = linkPack;

const OPEN = 1;

export default class WebSocketLink extends BaseLink {
  readonly #socket: linkWebsocketTypes.WebSocketLike;
  readonly #compress: boolean;
  #outbox: (string | Uint8Array)[] = [];

  constructor(
    socket: linkWebsocketTypes.WebSocketLike,
    options: linkWebsocketTypes.WebSocketLinkOptions = {},
  ) {
    super();
    this.#socket = socket;
    this.#compress = options.compress ?? false;
    const acceptPacked = options.acceptPacked ?? true;
    if ("binaryType" in socket) (socket as { binaryType: string }).binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      for (const data of this.#outbox.splice(0)) socket.send(data);
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = event.data;
        if (typeof data === "string") {
          this.deliver(parseFrame(data));
          return;
        }
        if (!acceptPacked) throw new TypeError("packed frames are not accepted");
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : undefined;
        if (bytes === undefined) throw new TypeError("unknown message type");
        const { envelope, field, bytes: payload } = splitMessage(bytes);
        if (zlibAvailable)
          this.deliver({ ...envelope, [field]: new Packed(payload) } as wireTypes.Frame);
        else
          this.deliverLater(
            inflate(payload).then((value) => ({ ...envelope, [field]: value }) as wireTypes.Frame),
          );
      } catch {
        this.close("protocol error");
      }
    });
    socket.addEventListener("close", () => this.ended("socket closed"));
  }

  protected transmit(frame: wireTypes.Frame): number {
    const data = packMessage(frame, this.#compress);
    if (this.#socket.readyState === OPEN) this.#socket.send(data);
    else this.#outbox.push(data);
    return typeof data === "string" ? data.length : data.byteLength;
  }

  protected shutdown(): void {
    this.#outbox = [];
    if (this.#socket.readyState <= OPEN) this.#socket.close(1000);
  }
}
