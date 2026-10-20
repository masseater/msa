import type layoutNodeTypes from "./layout-node.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

const LAYOUT_NODE = Symbol.for("@msa/tui/layout-node");

function getLayoutNode(
  component: tuiComponentTypes.Component,
): layoutNodeTypes.LayoutNode | undefined {
  const candidate = component as Partial<layoutNodeTypes.LayoutComponent>;
  return typeof candidate[LAYOUT_NODE] === "function" ? candidate[LAYOUT_NODE]() : undefined;
}

const layoutNode = {
  LAYOUT_NODE,
  getLayoutNode,
};

export default layoutNode;
