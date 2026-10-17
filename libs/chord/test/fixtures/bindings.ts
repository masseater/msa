import { Effect } from "effect";
import { Type } from "typebox";

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

export const until = pollUntil(200, Effect.sleep(2));

export const NoteSchema = Type.Array(Type.String());

export const Notes = remote("t.e8-notes", {
  version: 1,
  input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
  host: hostNamed("server"),
  variants: {
    main: {
      state: { notes: NoteSchema, title: Type.String() },
      methods: { add: method(Type.String()), rename: method(Type.String()) },
    },
  },
});

export function serveNotes(host: Host): void {
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NoteSchema, []);
    const title = self.state("title", Type.String(), "untitled");
    return {
      variant: "main",
      notes,
      title,
      add: (text: string, ctx: Ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(text);
        });
      },
      rename: (text: string, ctx: Ctx) => {
        title.replace(ctx, text);
      },
    };
  });
}

export function setup(
  options: {
    readonly window?: number;
    readonly linger?: { types?: Record<string, number>; cap?: number };
  } = {},
) {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveNotes(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, {
    principal: { user: "u" },
    ...(options.window === undefined ? {} : { window: options.window }),
  });
  const link = new CountingLink(up);
  const errors: unknown[] = [];
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link, principal: { kind: "server" } },
    onError: (error) => errors.push(error),
    ...(options.linger === undefined ? {} : { linger: options.linger }),
  });
  return { server, browser, link, errors };
}
