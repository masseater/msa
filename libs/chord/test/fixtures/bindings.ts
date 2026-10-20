import { Effect } from "effect";
import { Type } from "typebox";

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

const until = pollUntil(200, Effect.sleep(2));

const NoteSchema = Type.Array(Type.String());

const Notes = remote("t.e8-notes", {
  host: hostNamed("server"),
  input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
  variants: {
    main: {
      methods: { add: method(Type.String()), rename: method(Type.String()) },
      state: { notes: NoteSchema, title: Type.String() },
    },
  },
  version: 1,
});

function serveNotes(host: Host): void {
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NoteSchema, []);
    const title = self.state("title", Type.String(), "untitled");
    return {
      add: (text: string, ctx: Ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(text);
        });
      },
      notes,
      rename: (text: string, ctx: Ctx) => {
        title.replace(ctx, text);
      },
      title,
      variant: "main",
    };
  });
}

function setup(
  options: {
    readonly window?: number;
    readonly linger?: { types?: Record<string, number>; cap?: number };
  } = {},
) {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  serveNotes(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, {
    principal: { user: "u" },
    ...(options.window === undefined ? {} : { window: options.window }),
  });
  const link = new CountingLink(up);
  const errors: unknown[] = [];
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: (error) => errors.push(error),
    self: { kind: "host" },
    upstream: { link, principal: { kind: "server" } },
    ...(options.linger === undefined ? {} : { linger: options.linger }),
  });
  return { browser, errors, link, server };
}

const bindings = {
  NoteSchema,
  Notes,
  serveNotes,
  setup,
  until,
};

export default bindings;
