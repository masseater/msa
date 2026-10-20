import assert from "node:assert/strict";

import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import schemaModule from "../src/schema.ts";

const { bind, coverage, hostFamily, hostNamed, isChordError, local, method, opaque, remote } =
  chord;
const { canonicalIdentity, fits, normalize } = schemaModule;

const View = Type.Object({ text: Type.String() });

const chatV1 = remote("t.chat", {
  host: hostFamily("session:", "session"),
  input: Type.Object({ conversation: Type.Number({ default: 0 }), session: Type.String() }),
  variants: {
    participant: {
      methods: {
        send: method(Type.Object({ text: Type.String() }), Type.Object({ id: Type.Number() })),
      },
      state: { view: View },
    },
    viewer: { state: { view: View } },
  },
  version: 1,
});

const normalizesInputAndOmitsDefaultsFrom = (): void => {
  const a = normalize(chatV1.input, { extra: 1, session: "s" }, "input");
  assert.deepEqual(a, { conversation: 0, session: "s" });
  const b = normalize(chatV1.input, { conversation: 0, session: "s" }, "input");
  assert.equal(canonicalIdentity(chatV1.input, a), canonicalIdentity(chatV1.input, b));
  assert.equal(canonicalIdentity(chatV1.input, a), '{"session":"s"}');
  assert.throws(
    () => normalize(chatV1.input, { session: 1 }, "input"),
    (error) => isChordError(error, "invalid") && error.reason === "input",
  );
};

const fingerprintsAreStableAndDescriptionBased = (): void => {
  const copy = remote("t.chat", chatV1.def);
  assert.equal(copy.fingerprint, chatV1.fingerprint);
  assert.notEqual(remote("t.chat", { ...chatV1.def, version: 2 }).fingerprint, chatV1.fingerprint);
};

const rejectsReservedMemberNamesAndOpaque = (): void => {
  assert.throws(() =>
    local("t.x", { input: Type.Object({}), members: { status: method() }, version: 1 }),
  );
  assert.throws(() =>
    remote("t.x", {
      host: hostNamed("server"),
      input: Type.Object({}),
      variants: { a: { state: { h: opaque("x@1") as never } } },
      version: 1,
    }),
  );
};

const coversAdditiveChangesAndRefusesBreaking = (): void => {
  const additive = remote("t.chat", {
    ...chatV1.def,
    variants: {
      ...chatV1.def.variants,
      participant: {
        methods: {
          send: method(
            Type.Object({ text: Type.String(), urgent: Type.Optional(Type.Boolean()) }),
            Type.Object({ at: Type.Number(), id: Type.Number() }),
          ),
        },
        state: { view: Type.Object({ extra: Type.Number(), text: Type.String() }) },
      },
    },
  });
  assert.equal(coverage(additive.description, chatV1.description), undefined);
  assert.equal(bind(additive, undefined, chatV1), undefined);

  const required = remote("t.chat", {
    ...chatV1.def,
    variants: {
      ...chatV1.def.variants,
      participant: {
        methods: {
          send: method(
            Type.Object({ text: Type.String(), urgent: Type.Boolean() }),
            Type.Object({ id: Type.Number() }),
          ),
        },
        state: { view: View },
      },
    },
  });
  assert.match(coverage(required.description, chatV1.description) ?? "", /arguments/u);
  assert.throws(
    () => bind(required, undefined, chatV1),
    (error) => isChordError(error, "contract_mismatch"),
  );

  const retyped = remote("t.chat", {
    ...chatV1.def,
    variants: {
      ...chatV1.def.variants,
      viewer: { state: { view: Type.Object({ text: Type.Number() }) } },
    },
  });
  assert.match(coverage(retyped.description, chatV1.description) ?? "", /state/u);
};

const methodsWithoutArgumentsOrResultDescribed = (): void => {
  const of = (members: NonNullable<Parameters<typeof local>[1]["members"]>) =>
    local("t.methods", { input: Type.Object({}), members, version: 1 }).description;
  const none = of({ m: method() });
  assert.deepEqual(none.variants[""]?.["m"], { kind: "method" });
  const withArgs = of({ m: method(Type.String()) });
  const withResult = of({ m: method(undefined, Type.Number()) });
  assert.equal(coverage(none, none), undefined);
  assert.match(
    coverage(withArgs, none) ?? "",
    /arguments/u,
    "the consumer sends none, the provider expects some",
  );
  assert.match(
    coverage(none, withArgs) ?? "",
    /arguments/u,
    "the consumer sends some, the provider takes none",
  );
  assert.equal(coverage(withResult, none), undefined, "a void consumer ignores a result");
  assert.match(
    coverage(none, withResult) ?? "",
    /result/u,
    "a consumer expecting a result needs one",
  );
};

const bindsOtherVersionsOnlyThroughAccepts = (): void => {
  const v2 = remote("t.chat", {
    ...chatV1.def,
    variants: { viewer: { state: { body: View } } },
    version: 2,
  });
  assert.throws(
    () => bind(v2, undefined, chatV1),
    (error) => isChordError(error, "contract_mismatch"),
  );
  const adapter = (current: Record<string, unknown>) => ({
    variant: "viewer",
    view: current["body"],
  });
  assert.equal(bind(v2, { 1: adapter }, chatV1), adapter);
};

const comparesOpaqueMembersByNameVersion = (): void => {
  const a = local("t.idx", {
    input: Type.Object({}),
    members: {
      harness: opaque("h@1"),
      onChange: method(Type.Function([Type.String()], Type.Void())),
    },
    version: 1,
  });
  const b = local("t.idx", { ...a.def, members: { ...a.def.members, harness: opaque("h@2") } });
  assert.match(coverage(b.description, a.description) ?? "", /opaque/u);
  assert.ok(
    fits(Type.Function([Type.Unknown()], Type.Void()), Type.Function([Type.String()], Type.Void())),
  );
  assert.ok(
    !fits(
      Type.Function([Type.String()], Type.Void()),
      Type.Function([Type.Unknown()], Type.Void()),
    ),
  );
};

describe("contracts", () => {
  it("normalizes input and omits defaults from the identity", normalizesInputAndOmitsDefaultsFrom);

  it("fingerprints are stable and description-based", fingerprintsAreStableAndDescriptionBased);

  it(
    "rejects reserved member names and opaque remote members",
    rejectsReservedMemberNamesAndOpaque,
  );

  it("covers additive changes and refuses breaking ones", coversAdditiveChangesAndRefusesBreaking);

  it(
    "methods without arguments or result: described without them; their presence must match, a void consumer accepts a result",
    methodsWithoutArgumentsOrResultDescribed,
  );

  it("binds other versions only through accepts adapters", bindsOtherVersionsOnlyThroughAccepts);

  it(
    "compares opaque members by name@version and function members structurally",
    comparesOpaqueMembersByNameVersion,
  );
});
