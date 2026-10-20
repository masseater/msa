import type { Host, memoryLinkPair } from "../../src/index.ts";

declare namespace linkTypes {
  interface Cluster {
    readonly server: Host;
    readonly workers: Map<string, Host>;
    readonly log: string[];
    browser(
      principal: unknown,
      options?: { restamp?: (principal: unknown) => unknown | undefined },
    ): {
      host: Host;
      up: ReturnType<typeof memoryLinkPair>[1];
      reconnect(): void;
    };
    allow: (principal: unknown, host: string) => boolean;
  }
}

export type { linkTypes as default };
