import type tuiTypes from "@msa/tui/index.types";

function createFakeTui(): tuiTypes.TUI {
  return { requestRender: () => {} } as unknown as tuiTypes.TUI;
}

const fakeTuiSupport = {
  createFakeTui,
};

export default fakeTuiSupport;
