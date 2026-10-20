import type StdinBufferClass from "./stdin-buffer.ts";

declare namespace stdinBufferTypes {
  type StdinBufferOptions = {
    timeout?: number;
    escapeTimeout?: number;
  };

  type StdinBufferEventMap = {
    data: [string];
    paste: [string];
  };

  type StdinBuffer = StdinBufferClass;
}

export type { stdinBufferTypes as default };
