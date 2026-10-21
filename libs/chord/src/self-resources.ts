import { dual } from "effect/Function";

import core from "./core.ts";
import type declareTypes from "./declare.ts";
import type declsTypes from "./decls.types.ts";
import ExposedImpl from "./exposed.ts";
import ResourceFacade from "./resource-facade.ts";
import resourceModule from "./resource.ts";
import type selfResourcesTypes from "./self-resources.types.ts";
import type typesModule from "./types.types.ts";

const { refOf } = core;
const { ResourceImpl, resourceOf } = resourceModule;

const resolveDeps = (name: string, declaration: declareTypes.ResourceDeclaration<unknown>) =>
  (declaration.deps ?? []).map((dep) => {
    const resolved = refOf(dep) ?? resourceOf(dep);
    if (resolved === undefined) {
      throw new TypeError(`resource ${name}: deps must be references or resources of this object`);
    }
    return resolved;
  });

function resourceDeclared<T>(
  scope: selfResourcesTypes.ResourceScope,
  name: string,
  declaration: declareTypes.ResourceDeclaration<T>,
): declareTypes.Resource<T> {
  if (!Number.isInteger(declaration.version))
    throw new TypeError(`resource ${name}: version must be an integer`);
  const deps = resolveDeps(name, declaration as declareTypes.ResourceDeclaration<unknown>);
  const existing = scope.previous?.resources.get(name);
  const kept =
    existing !== undefined &&
    existing.spec.version === declaration.version &&
    existing.exclusive === (declaration.exclusive === true) &&
    existing.deps.length === deps.length &&
    existing.deps.every((dep, index) => dep === deps[index]);
  const resource = kept
    ? existing
    : new ResourceImpl(name, declaration as declareTypes.ResourceDeclaration<unknown>, deps);
  if (kept)
    scope.decls.adopted.set(existing, declaration as declareTypes.ResourceDeclaration<unknown>);
  else scope.created.resources.push(resource);
  scope.decls.resources.set(name, resource);
  return new ResourceFacade(resource, scope.host) as unknown as declareTypes.Resource<T>;
}

function resourceExposed<T>(
  decls: declsTypes.Decls,
  resource: declareTypes.Resource<T>,
): typesModule.Exposed<T> {
  const resolved = resourceOf(resource);
  if (resolved === undefined || ![...decls.resources.values()].includes(resolved)) {
    throw new TypeError("expose takes a resource declared by this object");
  }
  return new ExposedImpl(resolved) as unknown as typesModule.Exposed<T>;
}

const declareResource: {
  <T>(
    name: string,
    declaration: declareTypes.ResourceDeclaration<T>,
  ): (scope: selfResourcesTypes.ResourceScope) => declareTypes.Resource<T>;
  <T>(
    scope: selfResourcesTypes.ResourceScope,
    name: string,
    declaration: declareTypes.ResourceDeclaration<T>,
  ): declareTypes.Resource<T>;
} = dual(3, resourceDeclared);

const exposeResource: {
  <T>(resource: declareTypes.Resource<T>): (decls: declsTypes.Decls) => typesModule.Exposed<T>;
  <T>(decls: declsTypes.Decls, resource: declareTypes.Resource<T>): typesModule.Exposed<T>;
} = dual(2, resourceExposed);

const selfResources = {
  declareResource,
  exposeResource,
};

export default selfResources;
