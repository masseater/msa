import { Container } from "../../../libs/tui/src/tui-component.ts";

function renderAll(container: Container, width = 120): string {
  return container.children.flatMap((child) => child.render(width)).join("\n");
}

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

function normalizeRenderedOutput(container: Container, width = 220): string {
  return renderAll(container, width)
    .replace(ANSI_SGR, "")
    .replace(/\\/gu, "/")
    .split("\n")
    .map((line) => line.replace(/\s+$/gu, ""))
    .join("\n")
    .trim();
}

const interactiveModeStatusSupport = {
  normalizeRenderedOutput,
  renderAll,
};

export default interactiveModeStatusSupport;
