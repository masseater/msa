import type codingAgentTypes from "@msa/coding-agent/index.types";
import type tuiTypes from "@msa/tui/index.types";

const editorTheme = (theme: codingAgentTypes.Theme): tuiTypes.EditorTheme => ({
  borderColor: (s) => theme.fg("accent", s),
  selectList: {
    description: (t) => theme.fg("muted", t),
    noMatch: (t) => theme.fg("warning", t),
    scrollInfo: (t) => theme.fg("dim", t),
    selectedPrefix: (t) => theme.fg("accent", t),
    selectedText: (t) => theme.fg("accent", t),
  },
});

const questionnaireTypes = {
  editorTheme,
};

export default questionnaireTypes;
