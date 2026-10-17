import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import {
  type Ctx,
  createHost,
  type Facet,
  type FacetLoader,
  type Frame,
  hostFamily,
  hostNamed,
  type Link,
  memoryLinkPair,
  method,
  remote,
  type Self,
} from "../../src/index.ts";

export const Greeter = remote("t.greeter", {
  version: 1,
  input: Type.Object({ session: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: {
    main: {
      state: { count: Type.Object({ n: Type.Number() }) },
      methods: { greet: method(Type.String(), Type.String()) },
    },
  },
});

export const GreeterV2 = remote("t.greeter", {
  version: 2,
  input: Type.Object({ session: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: { main: { methods: { hello: method(Type.String(), Type.String()) } } },
});

export const ServerGreeter = remote("t.server-greeter", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    main: {
      state: { count: Type.Object({ n: Type.Number() }) },
      methods: { greet: method(Type.String(), Type.String()) },
    },
  },
});

type GreeterOptions = { fail?: boolean; stateVersion?: number };

function greeterFacetImpl(greeting: string, options: GreeterOptions = {}): Facet {
  return {
    name: "greeter",
    setup: (api) => {
      const greeter = (self: Self) => {
        if (options.fail === true) throw new Error("worker factory fails");
        const count = self.state(
          "count",
          Type.Object({ n: Type.Number() }),
          { n: 0 },
          { version: options.stateVersion ?? 1 },
        );
        return {
          variant: "main" as const,
          count,
          greet: (name: string, ctx: Ctx) => {
            count.change(ctx, (draft) => {
              draft.n += 1;
            });
            return `${greeting} ${name}`;
          },
        };
      };
      if (api.name === "server")
        api.serve(ServerGreeter, (_input, _principal, self) => greeter(self));
      else api.serve(Greeter, (_input, _principal, self) => greeter(self));
    },
  };
}

function droppingImpl(link: Link, drop: (frame: Frame) => boolean): Link {
  return {
    get closed() {
      return link.closed;
    },
    send: (frame) => (drop(frame) ? undefined : link.send(frame)),
    receive: (handler) => link.receive(handler),
    onClose: (handler) => link.onClose(handler),
    close: (reason) => link.close(reason),
  };
}

export const Ping = remote("t.cluster-ping", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: { main: { methods: { ping: method(undefined, Type.String()) } } },
});

export function setup() {
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loader: FacetLoader = (names) =>
    Effect.runPromise(Effect.sync(() => names.map((name) => modules.get(String(name))!)));
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    loader,
    onError: () => {},
  });
  worker.install(modules.get("greeter")!);
  return { server, worker, modules, down };
}

export const greeterFacet: {
  (options?: GreeterOptions): (greeting: string) => Facet;
  (greeting: string, options?: GreeterOptions): Facet;
} = dual((args: IArguments) => typeof args[0] === "string", greeterFacetImpl);

export const dropping: {
  (drop: (frame: Frame) => boolean): (link: Link) => Link;
  (link: Link, drop: (frame: Frame) => boolean): Link;
} = dual(2, droppingImpl);
