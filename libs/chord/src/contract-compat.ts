import { dual } from "effect/Function";

import {
  type Accepts,
  type Adapter,
  type AnyContract,
  type Description,
  placementText,
} from "./contract.ts";
import { ChordError } from "./errors.ts";
import { canonicalJson, fits } from "./schema.ts";

function coverageGap(provider: Description, consumer: Description): string | undefined {
  if (provider.name !== consumer.name || provider.scope !== consumer.scope) return "different type";
  if (!samePlacement(provider, consumer)) return "host";
  if (!fits(consumer.input, provider.input)) return "input";
  for (const [kind, consumerMembers] of Object.entries(consumer.variants)) {
    const providerMembers = provider.variants[kind];
    if (providerMembers === undefined) return `variant ${kind} missing`;
    for (const [name, wanted] of Object.entries(consumerMembers)) {
      const offered = providerMembers[name];
      if (offered === undefined || offered.kind !== wanted.kind)
        return `${kind}.${name} missing or of another kind`;
      if (offered.kind === "method" && wanted.kind === "method") {
        if ((wanted.args === undefined) !== (offered.args === undefined))
          return `${kind}.${name} arguments`;
        if (
          wanted.args !== undefined &&
          offered.args !== undefined &&
          !fits(wanted.args, offered.args)
        )
          return `${kind}.${name} arguments`;
        if (
          wanted.result !== undefined &&
          (offered.result === undefined || !fits(offered.result, wanted.result))
        )
          return `${kind}.${name} result`;
      } else if (offered.kind === "state" && wanted.kind === "state") {
        if (!fits(offered.schema, wanted.schema)) return `${kind}.${name} state`;
      } else if (
        offered.kind === "opaque" &&
        wanted.kind === "opaque" &&
        offered.id !== wanted.id
      ) {
        return `${kind}.${name} opaque ${offered.id} != ${wanted.id}`;
      }
    }
  }
  return undefined;
}

const samePlacement = (a: Description, b: Description): boolean =>
  canonicalJson(a.host ?? null) === canonicalJson(b.host ?? null);
const placementOf = (description: Description): string =>
  description.host === undefined ? "(local)" : placementText(description.host);

function adapterFor(
  provider: AnyContract,
  accepts: Accepts | undefined,
  consumer: AnyContract,
): Adapter | undefined {
  if (provider.fingerprint === consumer.fingerprint) return undefined;
  if (!samePlacement(provider.description, consumer.description)) {
    throw new ChordError(
      "contract_mismatch",
      `${provider.name} lives on ${placementOf(provider.description)}, the consumer expects ${placementOf(consumer.description)}`,
    );
  }
  if (provider.version === consumer.version) {
    const reason = coverageGap(provider.description, consumer.description);
    if (reason === undefined) return undefined;
    throw new ChordError(
      "contract_mismatch",
      `${provider.name}@${provider.version} does not cover the consumer's description (${reason}); forgotten version bump?`,
    );
  }
  const adapter = accepts?.[consumer.version];
  if (adapter === undefined) {
    throw new ChordError(
      "contract_mismatch",
      `${provider.name}: provider version ${provider.version}, consumer version ${consumer.version}, no accepts adapter`,
    );
  }
  return adapter;
}

function hasNoArgs(contract: AnyContract, name: string): boolean {
  for (const members of Object.values(contract.description.variants)) {
    const member = members[name];
    if (member?.kind === "method") return member.args === undefined;
  }
  return false;
}

export const coverage: {
  (consumer: Description): (provider: Description) => string | undefined;
  (provider: Description, consumer: Description): string | undefined;
} = dual(2, coverageGap);

export const bind: {
  (
    accepts: Accepts | undefined,
    consumer: AnyContract,
  ): (provider: AnyContract) => Adapter | undefined;
  (provider: AnyContract, accepts: Accepts | undefined, consumer: AnyContract): Adapter | undefined;
} = dual(3, adapterFor);

export const takesNoArgs: {
  (name: string): (contract: AnyContract) => boolean;
  (contract: AnyContract, name: string): boolean;
} = dual(2, hasNoArgs);
