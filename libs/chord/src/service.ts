import { dual } from "effect/Function";
import type { TSchema } from "typebox";

import cell from "./cell.ts";
import contractModule from "./contract.ts";
import type contractTypes from "./contract.types.ts";
import errorsModule from "./errors.ts";
import schemaModule from "./schema.ts";
import type serviceTypes from "./service.types.ts";
import type typesModule from "./types.types.ts";

const { normalize } = schemaModule;
const { isSource } = cell;
const { LOCAL_VARIANT } = contractModule;
const { invalid } = errorsModule;

function checkLifetime(
  contract: contractTypes.AnyContract,
  options: serviceTypes.ServeOptions,
): void {
  const lifetime = options.lifetime ?? "referenced";
  if (lifetime !== "referenced" && lifetime !== "host")
    throw new TypeError(`${contract.name}: unknown lifetime ${String(lifetime)}`);
  if (lifetime !== "host") return;
  if (contract.scope !== "local")
    throw new TypeError(
      `${contract.name}: lifetime "host" needs a local type (remote types are referenced)`,
    );
  if (options.linger !== undefined)
    throw new TypeError(
      `${contract.name}: an object of lifetime "host" does not linger (it lives as long as the host)`,
    );
  try {
    normalize(contract.input, {}, `${contract.name} input`);
  } catch {
    throw new TypeError(
      `${contract.name}: lifetime "host" needs an input that accepts {} (the object's one address)`,
    );
  }
}

const makeService: {
  <C extends contractTypes.AnyContract>(
    factory: serviceTypes.Factory<C>,
    options: serviceTypes.ServeOptions,
    facet: string,
  ): (contract: C) => serviceTypes.Service;
  <C extends contractTypes.AnyContract>(
    contract: C,
    factory: serviceTypes.Factory<C>,
    options: serviceTypes.ServeOptions,
    facet: string,
  ): serviceTypes.Service;
} = dual(
  4,
  <C extends contractTypes.AnyContract>(
    contract: C,
    factory: serviceTypes.Factory<C>,
    options: serviceTypes.ServeOptions,
    facet: string,
  ): serviceTypes.Service => {
    checkLifetime(contract, options);
    return {
      contract,
      facet,
      factory: factory as unknown as serviceTypes.AnyFactory,
      options: options as serviceTypes.ServeOptions,
    };
  },
);

const hostLifetime = (service: serviceTypes.Service): boolean =>
  service.options.lifetime === "host";

const variantOf = (implementation: Record<string, unknown>): string | undefined =>
  typeof implementation["variant"] === "string" ? implementation["variant"] : undefined;

const isReadableLike = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as typesModule.Readable<unknown>).events === "function" &&
  typeof (value as typesModule.Readable<unknown>).subscribe === "function";

const isStateLike = (value: unknown): boolean => isSource(value) || isReadableLike(value);

const memberSchemas: {
  (
    implementation: Record<string, unknown>,
  ): (service: serviceTypes.Service) => Map<typesModule.Readable<unknown>, TSchema[]>;
  (
    service: serviceTypes.Service,
    implementation: Record<string, unknown>,
  ): Map<typesModule.Readable<unknown>, TSchema[]>;
} = dual(
  2,
  (
    service: serviceTypes.Service,
    implementation: Record<string, unknown>,
  ): Map<typesModule.Readable<unknown>, TSchema[]> => {
    const schemas = new Map<typesModule.Readable<unknown>, TSchema[]>();
    const contract = service.contract;
    if (contract.scope !== "remote") return schemas;
    const members = contract.description.variants[variantOf(implementation) ?? ""] ?? {};
    for (const [name, description] of Object.entries(members)) {
      const source = implementation[name];
      if (description.kind !== "state" || !isSource(source)) continue;
      schemas.set(source, [...(schemas.get(source) ?? []), description.schema]);
    }
    return schemas;
  },
);

function declaredMembers(
  contract: contractTypes.AnyContract,
  implementation: Record<string, unknown>,
  fail: (message: string) => never,
): Readonly<Record<string, contractTypes.MemberDescription>> {
  if (contract.scope !== "remote") return contract.description.variants[LOCAL_VARIANT] ?? {};
  const variant = implementation["variant"];
  if (typeof variant !== "string" || contract.description.variants[variant] === undefined)
    fail(`unknown variant ${String(variant)}`);
  const members = contract.description.variants[variant as string]!;
  for (const key of Object.keys(implementation))
    if (key !== "variant" && members[key] === undefined)
      fail(`${key} is not in variant ${String(variant)}`);
  return members;
}

const validateImplementation: {
  (implementation: Record<string, unknown>): (service: serviceTypes.Service) => void;
  (service: serviceTypes.Service, implementation: Record<string, unknown>): void;
} = dual(2, (service: serviceTypes.Service, implementation: Record<string, unknown>): void => {
  const contract = service.contract;
  const fail = (message: string): never => {
    throw invalid("implementation", `${contract.name}: ${message}`);
  };
  if (implementation === null || typeof implementation !== "object")
    fail("factory must return an object");
  const members = declaredMembers(contract, implementation, fail);
  for (const [name, description] of Object.entries(members)) {
    const value = implementation[name];
    if (description.kind === "method" && typeof value !== "function")
      fail(`${name} must be a method`);
    if (description.kind === "state" && !isSource(value) && !isReadableLike(value)) {
      fail(`${name} must be a cell, a derivation or a held object's state member`);
    }
    if (description.kind === "opaque" && value === undefined) fail(`${name} is missing`);
  }
});

const serviceModule = {
  hostLifetime,
  isReadableLike,
  isStateLike,
  makeService,
  memberSchemas,
  validateImplementation,
  variantOf,
};

export default serviceModule;
