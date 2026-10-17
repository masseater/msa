import type { ResourceImpl } from "./resource.ts";

export class ExposedImpl {
  readonly resource: ResourceImpl;
  constructor(resource: ResourceImpl) {
    this.resource = resource;
  }
}
