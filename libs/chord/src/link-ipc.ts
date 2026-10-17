import { BaseLink } from "./link-base.ts";
import { packObject, unpackObject } from "./link-pack.ts";
import type { Frame } from "./wire.ts";

export interface IpcChannel {
  readonly connected: boolean;
  send(message: unknown, callback?: (error: Error | null) => void): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "disconnect", listener: () => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "disconnect", listener: () => void): unknown;
}

export class IpcLink extends BaseLink {
  readonly #channel: IpcChannel;
  readonly #onMessage = (message: unknown): void => {
    const frame = (message as { chord2?: unknown } | null)?.chord2;
    if (frame === undefined) return;
    try {
      this.deliver(unpackObject(frame) as Frame);
    } catch {
      this.close("protocol error");
    }
  };
  readonly #onDisconnect = (): void => this.ended("ipc disconnected");
  readonly #onSent = (error: Error | null): void => {
    if (error !== null)
      this.ended(`ipc send failed: ${(error as { code?: string }).code ?? error.message}`);
  };

  constructor(channel: IpcChannel) {
    super();
    this.#channel = channel;
    channel.on("message", this.#onMessage);
    channel.on("disconnect", this.#onDisconnect);
  }

  protected transmit(frame: Frame): undefined {
    if (this.#channel.connected)
      this.#channel.send({ chord2: packObject(frame, true) }, this.#onSent);
    return undefined;
  }

  protected shutdown(): void {
    this.#channel.off("message", this.#onMessage);
    this.#channel.off("disconnect", this.#onDisconnect);
  }
}

export const ipcLink = (channel: IpcChannel): IpcLink => new IpcLink(channel);
