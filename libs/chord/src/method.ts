import { Value } from "typebox/value";

import contractModule from "./contract.ts";
import type contractTypes from "./contract.types.ts";
import type ctxTypes from "./ctx.types.ts";
import errorsModule from "./errors.ts";
import type objectTypes from "./object.types.ts";
import type refTypes from "./ref.types.ts";
import schemaModule from "./schema.ts";
import serviceModule from "./service.ts";

const { ChordError } = errorsModule;
const { variantOf } = serviceModule;
const { LOCAL_VARIANT } = contractModule;
const { assertValid } = schemaModule;

type MethodDescription = Extract<contractTypes.MemberDescription, { kind: "method" }>;

export default class ResolvedMethod {
  readonly fn: (...args: unknown[]) => unknown;
  readonly takesArgs: boolean;
  readonly returns: boolean;
  readonly #label: string;
  readonly #own: MethodDescription["args"];
  readonly #validated: MethodDescription | undefined;

  constructor(
    object: objectTypes.ObjectImpl,
    ref: refTypes.RefImpl,
    name: string,
    ctx: ctxTypes.CtxImpl,
  ) {
    const installed = object.implementations.get(ctx.codeVersion);
    if (installed === undefined)
      throw new ChordError(
        "superseded",
        `${object.address} has no implementation for code version ${ctx.codeVersion}`,
      );
    const view = ref.viewOf(installed);
    const variant = variantOf(view);
    const remote = ref.contract.scope === "remote";
    const wanted = ref.describe(remote ? variant : LOCAL_VARIANT, name);
    const fn = view[name];
    if (typeof fn !== "function" || (remote && wanted?.kind !== "method")) {
      throw new ChordError(
        "not_in_variant",
        `${object.address}: ${name} is not a method of variant ${variant ?? "(local)"}`,
      );
    }
    const schema =
      view === installed.implementation
        ? installed.service.contract.description.variants[variant ?? LOCAL_VARIANT]?.[name]
        : wanted;
    const method = schema?.kind === "method" ? schema : undefined;
    this.fn = fn as (...args: unknown[]) => unknown;
    this.#label = `${object.address}.${name}`;
    this.#own = remote && wanted?.kind === "method" ? wanted.args : undefined;
    this.#validated = remote ? method : undefined;
    this.takesArgs = method === undefined || method.args !== undefined;
    this.returns = method === undefined || method.result !== undefined;
  }

  input(args: unknown): unknown {
    const own = this.#own;
    const sent = own === undefined ? args : Value.Clean(own, Value.Clone(args));
    const argsSchema = this.#validated?.args;
    const input = argsSchema === undefined ? sent : Value.Clean(argsSchema, Value.Clone(sent));
    if (argsSchema !== undefined) assertValid("args", `${this.#label} args`, argsSchema, input);
    return input;
  }

  result(value: unknown): unknown {
    if (!this.returns) return undefined;
    const resultSchema = this.#validated?.result;
    if (resultSchema !== undefined)
      assertValid("result", `${this.#label} result`, resultSchema, value);
    return value;
  }
}
