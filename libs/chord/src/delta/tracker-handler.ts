import trackerGuards from "./tracker-guards.ts";
import trackerProps from "./tracker-props.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

const { assertReadable, assertWritable, isSettledContext, nodeBase, nodeForTarget } = trackerGuards;
const { NODE } = trackerTypes;

const sharedObjectHandler: ProxyHandler<object> = {
  defineProperty(target) {
    assertWritable(nodeForTarget(target).context);
    throw new TypeError("Defining overlay properties is not supported");
  },
  deleteProperty(target, property) {
    return trackerProps.deleteProperty(nodeForTarget(target), property);
  },
  get(target, property) {
    if (property === "then") {
      const node = (target as Record<PropertyKey, unknown>)[NODE] as
        | trackerTypesModule.OverlayNode
        | undefined;
      if (node === undefined || isSettledContext(node.context)) return undefined;
    }
    const node = nodeForTarget(target);
    if (property === NODE) return node;
    return trackerProps.getProperty(node, property);
  },
  getOwnPropertyDescriptor(target, property) {
    return trackerProps.getDescriptor(nodeForTarget(target), property);
  },
  getPrototypeOf(target) {
    const node = nodeForTarget(target);
    assertReadable(node.context);
    return Object.getPrototypeOf(nodeBase(node));
  },
  has(target, property) {
    return trackerProps.hasProperty(nodeForTarget(target), property);
  },
  isExtensible(target) {
    assertReadable(nodeForTarget(target).context);
    return true;
  },
  ownKeys(target) {
    return trackerProps.ownKeys(nodeForTarget(target));
  },
  preventExtensions(target) {
    assertWritable(nodeForTarget(target).context);
    throw new TypeError("Overlays cannot be made non-extensible");
  },
  set(target, property, value) {
    return trackerProps.setProperty(nodeForTarget(target), property, value);
  },
  setPrototypeOf(target) {
    assertWritable(nodeForTarget(target).context);
    throw new TypeError("Changing an overlay prototype is not supported");
  },
};

const sharedArrayHandler: ProxyHandler<object> = sharedObjectHandler;

const trackerHandler = {
  sharedArrayHandler,
  sharedObjectHandler,
};

export default trackerHandler;
