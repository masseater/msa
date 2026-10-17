import { Effect } from "effect";
import { dual } from "effect/Function";
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

export const until = pollUntil(400, Effect.sleep(2));

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

const linesImpl = (kib: number, tag: string): string[] =>
  Array.from({ length: kib }, (_, i) => `${tag}${i}:${"x".repeat(1000)}`);

function serveBlobImpl(host: Host, size: (name: string) => number): void {
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

function clientImpl(server: Host, window: number, pendingCap?: number) {
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

export const lines: {
  (tag: string): (kib: number) => string[];
  (kib: number, tag: string): string[];
} = dual(2, linesImpl);

export const serveBlob: {
  (size: (name: string) => number): (host: Host) => void;
  (host: Host, size: (name: string) => number): void;
} = dual(2, serveBlobImpl);

type Client = ReturnType<typeof clientImpl>;

export const client: {
  (window: number, pendingCap?: number): (server: Host) => Client;
  (server: Host, window: number, pendingCap?: number): Client;
} = dual((args: IArguments) => typeof args[0] === "object", clientImpl);
