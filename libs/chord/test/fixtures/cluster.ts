import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import {
  type Ctx,
  type Facet,
  type FacetLoader,
  type Frame,
  type Link,
  type Self,
  createHost,
  hostFamily,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
} from "../../src/index.ts";

const Greeter = remote("t.greeter", {
  host: hostFamily("session:", "session"),
  input: Type.Object({ session: Type.String() }),
  variants: {
    main: {
      methods: { greet: method(Type.String(), Type.String()) },
      state: { count: Type.Object({ n: Type.Number() }) },
    },
  },
  version: 1,
});

const GreeterV2 = remote("t.greeter", {
  host: hostFamily("session:", "session"),
  input: Type.Object({ session: Type.String() }),
  variants: { main: { methods: { hello: method(Type.String(), Type.String()) } } },
  version: 2,
});

const ServerGreeter = remote("t.server-greeter", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: {
    main: {
      methods: { greet: method(Type.String(), Type.String()) },
      state: { count: Type.Object({ n: Type.Number() }) },
    },
  },
  version: 1,
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
          count,
          greet: (name: string, ctx: Ctx) => {
            count.change(ctx, (draft) => {
              draft.n += 1;
            });
            return `${greeting} ${name}`;
          },
          variant: "main" as const,
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
    close: (reason) => link.close(reason),
    get closed() {
      return link.closed;
    },
    onClose: (handler) => link.onClose(handler),
    receive: (handler) => link.receive(handler),
    send: (frame) => (drop(frame) ? undefined : link.send(frame)),
  };
}

const Ping = remote("t.cluster-ping", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: { methods: { ping: method(undefined, Type.String()) } } },
  version: 1,
});

function setup() {
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loader: FacetLoader = (names) =>
    Effect.runPromise(Effect.sync(() => names.map((name) => modules.get(String(name))!)));
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:S1", principal: { worker: "w" } });
  const worker = createHost({
    loader,
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  worker.install(modules.get("greeter")!);
  return { down, modules, server, worker };
}

const greeterFacet: {
  (options?: GreeterOptions): (greeting: string) => Facet;
  (greeting: string, options?: GreeterOptions): Facet;
} = dual((args: IArguments) => typeof args[0] === "string", greeterFacetImpl);

const dropping: {
  (drop: (frame: Frame) => boolean): (link: Link) => Link;
  (link: Link, drop: (frame: Frame) => boolean): Link;
} = dual(2, droppingImpl);

const cluster = {
  Greeter,
  GreeterV2,
  Ping,
  ServerGreeter,
  dropping,
  greeterFacet,
  setup,
};

export default cluster;
