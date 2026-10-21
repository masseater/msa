import type chord from "../../src/index.ts";
import type chordTypes from "../../src/index.types.ts";

declare namespace linkTypes {
  interface Cluster {
    readonly server: chordTypes.Host;
    readonly workers: Map<string, chordTypes.Host>;
    readonly log: string[];
    browser(
      principal: unknown,
      options?: { restamp?: (principal: unknown) => unknown | undefined },
    ): {
      host: chordTypes.Host;
      up: ReturnType<typeof chord.memoryLinkPair>[1];
      reconnect(): void;
    };
    allow: (principal: unknown, host: string) => boolean;
  }
}

export type { linkTypes as default };
