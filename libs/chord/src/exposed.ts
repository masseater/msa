import type resourceTypes from "./resource.types.ts";

export default class ExposedImpl {
  readonly resource: resourceTypes.ResourceImpl;
  constructor(resource: resourceTypes.ResourceImpl) {
    this.resource = resource;
  }
}
