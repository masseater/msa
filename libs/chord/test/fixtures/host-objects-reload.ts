import assert from "node:assert/strict";

import { Type } from "typebox";

import { defineRegistry, type Facet, local, method, type Self } from "../../src/index.ts";

export const input = Type.Object({});

export const flags = Type.Record(Type.String(), Type.Boolean());

export const SwitchV1 = local("t.eager-switch", {
  version: 1,
  input,
  members: {
    enabled: Type.Boolean(),
    set: method(Type.Boolean()),
  },
});

export const SwitchV2 = local("t.eager-switch", {
  version: 2,
  input,
  members: {
    enabled: flags,
    set: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
  },
});

export const SwitchV3 = local("t.eager-switch", {
  version: 3,
  input,
  members: {
    enabled: flags,
    update: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
  },
});

export const Read = defineRegistry<() => unknown>("t.eager-switch-read");

const watchResource = (log: string[]) => (self: Self) =>
  self.resource("watch", {
    version: 1,
    open: () => {
      log.push("open");
      return null;
    },
    close: () => {
      log.push("close");
    },
  });

const switchV1 = (declareResource: (self: Self) => void): Facet => ({
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

const switchV2 = (declareResource: (self: Self) => void, valid: boolean): Facet => ({
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
            version: 2,
            migrate: (old, from) => {
              assert.equal(from, 1);
              return valid ? { 1: old as boolean } : ("invalid migration" as never);
            },
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

const switchV3 = (declareResource: (self: Self) => void): Facet => ({
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

export function switchFacets(log: string[]) {
  const declareResource = watchResource(log);
  return {
    v1: switchV1(declareResource),
    v2: (valid: boolean) => switchV2(declareResource, valid),
    v3: switchV3(declareResource),
  };
}

export const ReadV1 = local("t.eager-read", {
  version: 1,
  input: Type.Object({}),
  members: { read: method(undefined, Type.String()) },
});

export const ReadV2 = local("t.eager-read", {
  version: 2,
  input: Type.Object({}),
  members: { fetch: method(undefined, Type.String()) },
});

export const readerV1: Facet = {
  name: "read",
  setup: (api) => api.serve(ReadV1, () => ({ read: () => "one" }), { lifetime: "host" }),
};

export const readerV2 = (adapt = false): Facet => ({
  name: "read",
  setup: (api) =>
    api.serve(ReadV2, () => ({ fetch: () => "two" }), {
      lifetime: "host",
      ...(adapt
        ? { accepts: { 1: (current: Record<string, unknown>) => ({ read: current["fetch"] }) } }
        : {}),
    }),
});
