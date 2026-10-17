import { Effect } from "effect";
import { Type } from "typebox";

import { HostImpl } from "../../src/host.ts";
import {
  type Ctx,
  createHost,
  type Host,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
} from "../../src/index.ts";
import { CountingLink } from "./counting.ts";
import { pollUntil } from "./timing.ts";

export const until = (check: () => boolean, attempts = 400) =>
  pollUntil(check, attempts, Effect.sleep(2));

export const Blob = remote("t.e8-blob", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  host: hostNamed("server"),
  variants: {
    main: {
      state: { lines: Type.Array(Type.String()) },
      methods: { push: method(Type.String()), ping: method(undefined, Type.String()) },
    },
  },
});

export const lines = (kib: number, tag: string) =>
  Array.from({ length: kib }, (_, i) => `${tag}${i}:${"x".repeat(1000)}`);

export function serveBlob(host: Host, size: (name: string) => number): void {
  host.serve(Blob, ({ name }, _principal, self) => {
    const state = self.state("lines", Type.Array(Type.String()), lines(size(name), name));
    return {
      variant: "main",
      lines: state,
      push: (line: string, ctx: Ctx) => {
        state.change(ctx, (draft) => {
          draft.push(line);
        });
      },
      ping: () => "pong",
    };
  });
}

export function client(server: Host, window: number, pendingCap?: number) {
  const [down, up] = memoryLinkPair();
  server.accept(down, {
    principal: { user: "u" },
    window,
    ...(pendingCap === undefined ? {} : { pendingCap }),
  });
  const link = new CountingLink(up);
  const host = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link, principal: { kind: "server" } },
    onError: () => {},
  });
  const connection = () =>
    [...(server as HostImpl).connections].find((candidate) => candidate.role === "downstream")!;
  return { host, link, connection };
}
