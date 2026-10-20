import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

const { NODE } = trackerTypes;

function nodeBase(node: trackerTypesModule.OverlayNode): trackerTypesModule.Container {
  return node.context.bases![node.baseIndex]!;
}

function nodeParent(
  node: trackerTypesModule.OverlayNode,
): trackerTypesModule.OverlayNode | undefined {
  return node.parentIndex < 0 ? undefined : node.context.nodes[node.parentIndex];
}

function nodeForTarget(target: object): trackerTypesModule.OverlayNode {
  const node = (target as Record<PropertyKey, unknown>)[NODE] as
    | trackerTypesModule.OverlayNode
    | undefined;
  if (node === undefined) throw new TypeError("Cannot use a settled overlay");
  return node;
}

function isSettledContext(context: trackerTypesModule.OverlayContext): boolean {
  return (
    context.overlayReleased ||
    context.status.value === "consumed" ||
    context.status.value === "aborted" ||
    context.status.value === "stale"
  );
}

function assertReadable(context: trackerTypesModule.OverlayContext): void {
  if (isSettledContext(context)) throw new TypeError("Cannot use a settled overlay");
}

function assertWritable(context: trackerTypesModule.OverlayContext): void {
  assertReadable(context);
  if (context.status.value !== "open") throw new TypeError("Prepared overlays are read-only");
}

const trackerGuards = {
  assertReadable,
  assertWritable,
  isSettledContext,
  nodeBase,
  nodeForTarget,
  nodeParent,
};

export default trackerGuards;
