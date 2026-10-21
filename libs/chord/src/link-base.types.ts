import type BaseLinkClass from "./link-base.ts";
import type wireTypes from "./wire.types.ts";

declare namespace linkBaseTypes {
  interface Link {
    readonly closed: boolean;
    send(frame: wireTypes.Frame): number | undefined;
    receive(handler: (frame: wireTypes.Frame) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(reason?: string): void;
  }

  type BaseLink = BaseLinkClass;
}

export type { linkBaseTypes as default };
