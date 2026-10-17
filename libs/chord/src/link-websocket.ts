import { dual } from "effect/Function";

import { BaseLink } from "./link-base.ts";
import {
  inflate,
  Packed,
  packMessage,
  parseFrame,
  splitMessage,
  zlibAvailable,
} from "./link-pack.ts";
import type { Frame } from "./wire.ts";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
}

const OPEN = 1;

export interface WebSocketLinkOptions {
  readonly compress?: boolean;
  readonly acceptPacked?: boolean;
}

export class WebSocketLink extends BaseLink {
  readonly #socket: WebSocketLike;
  readonly #compress: boolean;
  #outbox: (string | Uint8Array)[] = [];

  constructor(socket: WebSocketLike, options: WebSocketLinkOptions = {}) {
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
        if (!zlibAvailable)
          this.deliverLater(
            inflate(payload).then((value) => ({ ...envelope, [field]: value }) as Frame),
          );
        else this.deliver({ ...envelope, [field]: new Packed(payload) } as Frame);
      } catch {
        this.close("protocol error");
      }
    });
    socket.addEventListener("close", () => this.ended("socket closed"));
  }

  protected transmit(frame: Frame): number {
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

export const webSocketLink: {
  (options?: WebSocketLinkOptions): (socket: WebSocketLike) => WebSocketLink;
  (socket: WebSocketLike, options?: WebSocketLinkOptions): WebSocketLink;
} = dual(
  (args) => args.length >= 1,
  (socket: WebSocketLike, options?: WebSocketLinkOptions): WebSocketLink =>
    new WebSocketLink(socket, options),
);
