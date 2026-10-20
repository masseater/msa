import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import { HostImpl } from "../../src/host.ts";
import {
  type Ctx,
  type Host,
  createHost,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
} from "../../src/index.ts";
import counting from "./counting.ts";
import timing from "./timing.ts";

const { CountingLink } = counting;
const { pollUntil } = timing;

const until = pollUntil(400, Effect.sleep(2));

const Blob = remote("t.e8-blob", {
  host: hostNamed("server"),
  input: Type.Object({ name: Type.String() }),
  variants: {
    main: {
      methods: { ping: method(undefined, Type.String()), push: method(Type.String()) },
      state: { lines: Type.Array(Type.String()) },
    },
  },
  version: 1,
});

const linesImpl = (kib: number, tag: string): string[] =>
  Array.from({ length: kib }, (_, i) => `${tag}${i}:${"x".repeat(1000)}`);

function serveBlobImpl(host: Host, size: (name: string) => number): void {
  host.serve(Blob, ({ name }, _principal, self) => {
    const state = self.state("lines", Type.Array(Type.String()), lines(size(name), name));
    return {
      lines: state,
      ping: () => "pong",
      push: (line: string, ctx: Ctx) => {
        state.change(ctx, (draft) => {
          draft.push(line);
        });
      },
      variant: "main",
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
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link, principal: { kind: "server" } },
  });
  const connection = () =>
    [...(server as HostImpl).connections].find((candidate) => candidate.role === "downstream")!;
  return { connection, host, link };
}

const lines: {
  (tag: string): (kib: number) => string[];
  (kib: number, tag: string): string[];
} = dual(2, linesImpl);

const serveBlob: {
  (size: (name: string) => number): (host: Host) => void;
  (host: Host, size: (name: string) => number): void;
} = dual(2, serveBlobImpl);

type Client = ReturnType<typeof clientImpl>;

const client: {
  (window: number, pendingCap?: number): (server: Host) => Client;
  (server: Host, window: number, pendingCap?: number): Client;
} = dual((args: IArguments) => typeof args[0] === "object", clientImpl);

const flowUnits = {
  Blob,
  client,
  lines,
  serveBlob,
  until,
};

export default flowUnits;
