import tuiComponent from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

const { Container } = tuiComponent;

function containsComponent(
  root: tuiComponentTypes.Component,
  target: tuiComponentTypes.Component,
): boolean {
  if (root === target) return true;
  if (!(root instanceof Container)) return false;
  return root.children.some((child) => containsComponent(child, target));
}

const overlayContains = {
  containsComponent,
};

export default overlayContains;
