import type { Context, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";
import StaticString from "./static-string.ts";
import ValueFlow from "./value-flow.ts";

type Kind = "global" | "process";
type Outcome = flowTypes.Outcome<Kind>;
type ReflectiveCall = {
  readonly holder: flowTypes.Holder;
  readonly index: number;
  readonly kind: Kind;
  readonly name: string;
};

const LOOKUP = "getBuiltinModule";
const PROCESS_SPECIFIERS: ReadonlySet<string> = new Set(["node:process", "process"]);
const GLOBAL_OBJECTS: readonly string[] = ["global", "globalThis", "self", "window"];
const REFLECTIVE_OWNERS: ReadonlySet<string> = new Set(["Object", "Reflect"]);
const KEYED_REFLECTION: ReadonlySet<string> = new Set([
  "defineProperty",
  "deleteProperty",
  "get",
  "getOwnPropertyDescriptor",
  "has",
  "set",
]);
const SPILLING_REFLECTION: ReadonlySet<string> = new Set([
  "assign",
  "entries",
  "getOwnPropertyDescriptors",
  "values",
]);

const HIDDEN_KEY: Readonly<Record<Kind, string>> = { global: "process", process: LOOKUP };

const hiddenOutcome = (kind: Kind, key: flowTypes.Key): Outcome =>
  kind === "global" && key.name !== undefined ? "process" : "unknown";

const memberOutcome = (kind: Kind, key: flowTypes.Key): Outcome =>
  key.mayBe(HIDDEN_KEY[kind]) ? hiddenOutcome(kind, key) : "ok";

class LookupFlow {
  readonly #context: Context;
  readonly #strings: StaticString;
  readonly #values: ValueFlow<Kind>;

  constructor(options: {
    readonly context: Context;
    readonly unknown: (node: flowTypes.Node) => void;
  }) {
    this.#context = options.context;
    this.#strings = new StaticString(options.context);
    this.#values = new ValueFlow<Kind>({
      context: options.context,
      flow: {
        argument: (kind, holder, index) => this.#argumentOutcome(kind, holder, index),
        call: () => "unknown",
        escape: () => "ok",
        member: memberOutcome,
        unknown: options.unknown,
      },
    });
  }

  isLookup(node: flowTypes.Node): boolean {
    return this.#strings.fold(node) === LOOKUP;
  }

  fromGlobals(): void {
    for (const name of GLOBAL_OBJECTS) this.#trackGlobal(name, "global");
    this.#trackGlobal("process", "process");
  }

  fromImport(node: ESTree.ImportDeclaration): void {
    if (PROCESS_SPECIFIERS.has(node.source.value))
      for (const specifier of node.specifiers) this.#bindImported(specifier);
  }

  #trackGlobal(name: string, kind: Kind): void {
    for (const identifier of scopeLookup.globalReferences(this.#context, name))
      this.#values.track(identifier, kind);
  }

  #bindImported(specifier: ESTree.ImportDeclarationSpecifier): void {
    if (specifier.type !== "ImportSpecifier") this.#values.bind(specifier.local, "process");
  }

  #argumentOutcome(kind: Kind, holder: flowTypes.Holder, index: number): Outcome {
    const name = holder.type === "CallExpression" ? this.#reflection(holder.callee) : undefined;
    return name === undefined ? "ok" : this.#reflectionOutcome({ holder, index, kind, name });
  }

  #reflection(callee: flowTypes.Node): string | undefined {
    return callee.type === "MemberExpression" &&
      scopeLookup.isGlobalNamed(this.#context, callee.object, REFLECTIVE_OWNERS)
      ? scopeLookup.staticMemberName(callee)
      : undefined;
  }

  #reflectionOutcome(call: ReflectiveCall): Outcome {
    if (SPILLING_REFLECTION.has(call.name)) return "unknown";
    return call.index === 0 && KEYED_REFLECTION.has(call.name) ? this.#keyedOutcome(call) : "ok";
  }

  #keyedOutcome(call: ReflectiveCall): Outcome {
    const [, keyNode] = (call.holder as ESTree.CallExpression).arguments;
    return this.#values.key(keyNode).mayBe(HIDDEN_KEY[call.kind]) ? "unknown" : "ok";
  }
}

export default LookupFlow;
