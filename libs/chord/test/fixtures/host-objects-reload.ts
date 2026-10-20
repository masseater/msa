import assert from "node:assert/strict";

import { Type } from "typebox";

import chord from "../../src/index.ts";
import type chordTypes from "../../src/index.types.ts";

const { defineRegistry, local, method } = chord;

const input = Type.Object({});

const flags = Type.Record(Type.String(), Type.Boolean());

const SwitchV1 = local("t.eager-switch", {
  input,
  members: {
    enabled: Type.Boolean(),
    set: method(Type.Boolean()),
  },
  version: 1,
});

const SwitchV2 = local("t.eager-switch", {
  input,
  members: {
    enabled: flags,
    set: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
  },
  version: 2,
});

const SwitchV3 = local("t.eager-switch", {
  input,
  members: {
    enabled: flags,
    update: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
  },
  version: 3,
});

const Read = defineRegistry<() => unknown>("t.eager-switch-read");

const watchResource = (log: string[]) => (self: chordTypes.Self) =>
  self.resource("watch", {
    close: () => {
      log.push("close");
    },
    open: () => {
      log.push("open");
      return null;
    },
    version: 1,
  });

const switchV1 = (declareResource: (self: chordTypes.Self) => void): chordTypes.Facet => ({
  name: "switch",
  setup: (api) =>
    api.serve(
      SwitchV1,
      (_input, _principal, self) => {
        declareResource(self);
        const enabledState = self.state("enabled", Type.Boolean(), false);
        self.register(Read, { current: () => enabledState.value });
        return {
          enabled: enabledState,
          set: (enabled, ctx) => {
            enabledState.replace(ctx, enabled);
          },
        };
      },
      { lifetime: "host" },
    ),
});

const switchV2 = (
  declareResource: (self: chordTypes.Self) => void,
  valid: boolean,
): chordTypes.Facet => ({
  name: "switch",
  setup: (api) =>
    api.serve(
      SwitchV2,
      (_input, _principal, self) => {
        declareResource(self);
        const enabledState = self.state(
          "enabled",
          flags,
          {},
          {
            migrate: (old, from) => {
              assert.equal(from, 1);
              return valid ? { 1: old as boolean } : ("invalid migration" as never);
            },
            version: 2,
          },
        );
        self.register(Read, { current: () => enabledState.value });
        return {
          enabled: enabledState,
          set: ({ conversation, enabled }, ctx) => {
            enabledState.change(ctx, (draft) => {
              draft[conversation] = enabled;
            });
          },
        };
      },
      { lifetime: "host" },
    ),
});

const switchV3 = (declareResource: (self: chordTypes.Self) => void): chordTypes.Facet => ({
  name: "switch",
  setup: (api) =>
    api.serve(
      SwitchV3,
      (_input, _principal, self) => {
        declareResource(self);
        const enabledState = self.state("enabled", flags, {}, { version: 2 });
        self.register(Read, { current: () => enabledState.value });
        return {
          enabled: enabledState,
          update: ({ conversation, enabled }, ctx) => {
            enabledState.change(ctx, (draft) => {
              draft[conversation] = enabled;
            });
          },
        };
      },
      { lifetime: "host" },
    ),
});

function switchFacets(log: string[]) {
  const declareResource = watchResource(log);
  return {
    v1: switchV1(declareResource),
    v2: (valid: boolean) => switchV2(declareResource, valid),
    v3: switchV3(declareResource),
  };
}

const ReadV1 = local("t.eager-read", {
  input: Type.Object({}),
  members: { read: method(undefined, Type.String()) },
  version: 1,
});

const ReadV2 = local("t.eager-read", {
  input: Type.Object({}),
  members: { fetch: method(undefined, Type.String()) },
  version: 2,
});

const readerV1: chordTypes.Facet = {
  name: "read",
  setup: (api) => api.serve(ReadV1, () => ({ read: () => "one" }), { lifetime: "host" }),
};

const readerV2 = (adapt = false): chordTypes.Facet => ({
  name: "read",
  setup: (api) =>
    api.serve(ReadV2, () => ({ fetch: () => "two" }), {
      lifetime: "host",
      ...(adapt
        ? { accepts: { 1: (current: Record<string, unknown>) => ({ read: current["fetch"] }) } }
        : {}),
    }),
});

const hostObjectsReload = {
  Read,
  ReadV1,
  ReadV2,
  SwitchV1,
  SwitchV2,
  SwitchV3,
  flags,
  input,
  readerV1,
  readerV2,
  switchFacets,
};

export default hostObjectsReload;
