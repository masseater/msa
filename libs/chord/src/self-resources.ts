import { dual } from "effect/Function";

import type { HostCore } from "./core.ts";
import { refOf } from "./core.ts";
import type { Resource, ResourceDeclaration } from "./declare.ts";
import type { Decls, Run } from "./decls.ts";
import { ExposedImpl } from "./exposed.ts";
import { ResourceFacade } from "./resource-facade.ts";
import { ResourceImpl, resourceOf } from "./resource.ts";
import type { Exposed } from "./types.ts";

export type { ListenerDecl, Resource, ResourceDeclaration } from "./declare.ts";

export interface ResourceScope {
  readonly decls: Decls;
  readonly created: Run["created"];
  readonly previous: Decls | undefined;
  readonly host: HostCore;
}

const resolveDeps = (name: string, declaration: ResourceDeclaration<unknown>) =>
  (declaration.deps ?? []).map((dep) => {
    const resolved = refOf(dep) ?? resourceOf(dep);
    if (resolved === undefined) {
      throw new TypeError(`resource ${name}: deps must be references or resources of this object`);
    }
    return resolved;
  });

function resourceDeclared<T>(
  scope: ResourceScope,
  name: string,
  declaration: ResourceDeclaration<T>,
): Resource<T> {
  if (!Number.isInteger(declaration.version))
    throw new TypeError(`resource ${name}: version must be an integer`);
  const deps = resolveDeps(name, declaration as ResourceDeclaration<unknown>);
  const existing = scope.previous?.resources.get(name);
  const kept =
    existing !== undefined &&
    existing.spec.version === declaration.version &&
    existing.exclusive === (declaration.exclusive === true) &&
    existing.deps.length === deps.length &&
    existing.deps.every((dep, index) => dep === deps[index]);
  const resource = kept
    ? existing
    : new ResourceImpl(name, declaration as ResourceDeclaration<unknown>, deps);
  if (kept) scope.decls.adopted.set(existing, declaration as ResourceDeclaration<unknown>);
  else scope.created.resources.push(resource);
  scope.decls.resources.set(name, resource);
  return new ResourceFacade(resource, scope.host) as unknown as Resource<T>;
}

function resourceExposed<T>(decls: Decls, resource: Resource<T>): Exposed<T> {
  const resolved = resourceOf(resource);
  if (resolved === undefined || ![...decls.resources.values()].includes(resolved)) {
    throw new TypeError("expose takes a resource declared by this object");
  }
  return new ExposedImpl(resolved) as unknown as Exposed<T>;
}

export const declareResource: {
  <T>(name: string, declaration: ResourceDeclaration<T>): (scope: ResourceScope) => Resource<T>;
  <T>(scope: ResourceScope, name: string, declaration: ResourceDeclaration<T>): Resource<T>;
} = dual(3, resourceDeclared);

export const exposeResource: {
  <T>(resource: Resource<T>): (decls: Decls) => Exposed<T>;
  <T>(decls: Decls, resource: Resource<T>): Exposed<T>;
} = dual(2, resourceExposed);
