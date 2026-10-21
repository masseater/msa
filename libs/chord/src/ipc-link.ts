import type compressionTypes from "./compression.types.ts";
import BaseLink from "./link-base.ts";
import type linkIpcTypes from "./link-ipc.types.ts";
import linkPack from "./link-pack.ts";
import type wireTypes from "./wire.types.ts";

const { packObject, unpackObject } = linkPack;

export default class IpcLink extends BaseLink {
  readonly #channel: linkIpcTypes.IpcChannel;
  readonly #compression: compressionTypes.Compression | undefined;
  readonly #onMessage = (message: unknown): void => {
    const frame = (message as { chord2?: unknown } | null)?.chord2;
    if (frame === undefined) return;
    try {
      this.deliver(unpackObject(frame, this.#compression) as wireTypes.Frame);
    } catch {
      this.close("protocol error");
    }
  };
  readonly #onDisconnect = (): void => this.ended("ipc disconnected");
  readonly #onSent = (error: Error | null): void => {
    if (error !== null)
      this.ended(`ipc send failed: ${(error as { code?: string }).code ?? error.message}`);
  };

  constructor(channel: linkIpcTypes.IpcChannel, options: compressionTypes.CompressionOptions = {}) {
    super();
    this.#channel = channel;
    this.#compression = options.compression;
    channel.on("message", this.#onMessage);
    channel.on("disconnect", this.#onDisconnect);
  }

  protected transmit(frame: wireTypes.Frame): undefined {
    if (this.#channel.connected)
      this.#channel.send({ chord2: packObject(frame, this.#compression) }, this.#onSent);
    return undefined;
  }

  protected shutdown(): void {
    this.#channel.off("message", this.#onMessage);
    this.#channel.off("disconnect", this.#onDisconnect);
  }
}
