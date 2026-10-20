import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import type hostTypes from "../../src/host.types.ts";
import chord from "../../src/index.ts";
import type chordTypes from "../../src/index.types.ts";
import counting from "./counting.ts";
import timing from "./timing.ts";

const { createHost, hostNamed, memoryLinkPair, method, remote } = chord;

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

function serveBlobImpl(host: chordTypes.Host, size: (name: string) => number): void {
  host.serve(Blob, ({ name }, _principal, self) => {
    const state = self.state("lines", Type.Array(Type.String()), lines(size(name), name));
    return {
      lines: state,
      ping: () => "pong",
      push: (line: string, ctx: chordTypes.Ctx) => {
        state.change(ctx, (draft) => {
          draft.push(line);
        });
      },
      variant: "main",
    };
  });
}

function clientImpl(server: chordTypes.Host, window: number, pendingCap?: number) {
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
    [...(server as hostTypes.HostImpl).connections].find(
      (candidate) => candidate.role === "downstream",
    )!;
  return { connection, host, link };
}

const lines: {
  (tag: string): (kib: number) => string[];
  (kib: number, tag: string): string[];
} = dual(2, linesImpl);

const serveBlob: {
  (size: (name: string) => number): (host: chordTypes.Host) => void;
  (host: chordTypes.Host, size: (name: string) => number): void;
} = dual(2, serveBlobImpl);

type Client = ReturnType<typeof clientImpl>;

const client: {
  (window: number, pendingCap?: number): (server: chordTypes.Host) => Client;
  (server: chordTypes.Host, window: number, pendingCap?: number): Client;
} = dual((args: IArguments) => typeof args[0] === "object", clientImpl);

const flowUnits = {
  Blob,
  client,
  lines,
  serveBlob,
  until,
};

export default flowUnits;
