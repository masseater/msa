import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import questionnaireRender from "./questionnaire-render.ts";
import questionnaireTypes from "./questionnaire-types.ts";
import type questionnaireTypesTypes from "./questionnaire-types.types.ts";

const { editorTheme } = questionnaireTypes;
const { renderQuestionnaire } = questionnaireRender;

const { Editor, Key, matchesKey } = tuiModule;

const currentQuestion = (
  state: questionnaireTypesTypes.QuestionnaireState,
): questionnaireTypesTypes.Question | undefined => state.questions[state.currentTab];

const currentOptions = (
  state: questionnaireTypesTypes.QuestionnaireState,
): questionnaireTypesTypes.RenderOption[] => {
  const question = currentQuestion(state);
  if (question === undefined) return [];

  const options: questionnaireTypesTypes.RenderOption[] = [...question.options];
  if (question.allowOther) {
    options.push({ isOther: true, label: "Type something.", value: "__other__" });
  }
  return options;
};

const allAnswered = (state: questionnaireTypesTypes.QuestionnaireState): boolean =>
  state.questions.every((q) => state.answers.has(q.id));

const submit = (state: questionnaireTypesTypes.QuestionnaireState, cancelled: boolean): void => {
  state.done({
    answers: Array.from(state.answers.values()),
    cancelled,
    questions: state.questions,
  });
};

const saveAnswer = (
  state: questionnaireTypesTypes.QuestionnaireState,
  questionId: string,
  value: string,
  label: string,
  wasCustom: boolean,
  index?: number,
): void => {
  state.answers.set(questionId, { id: questionId, index, label, value, wasCustom });
};

const advanceAfterAnswer = (state: questionnaireTypesTypes.QuestionnaireState): void => {
  if (!state.isMulti) {
    submit(state, false);
    return;
  }

  state.currentTab =
    state.currentTab < state.questions.length - 1 ? state.currentTab + 1 : state.questions.length;
  state.optionIndex = 0;
  state.refresh();
};

const handleInputMode = (
  state: questionnaireTypesTypes.QuestionnaireState,
  data: string,
): boolean => {
  if (!state.inputMode) return false;

  if (matchesKey(data, Key.escape)) {
    state.inputMode = false;
    state.inputQuestionId = null;
    state.editor.setText("");
    state.refresh();
    return true;
  }

  state.editor.handleInput(data);
  state.refresh();
  return true;
};

const handleTabNavigation = (
  state: questionnaireTypesTypes.QuestionnaireState,
  data: string,
): boolean => {
  if (!state.isMulti) return false;

  if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
    state.currentTab = (state.currentTab + 1) % state.totalTabs;
    state.optionIndex = 0;
    state.refresh();
    return true;
  }
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
    state.currentTab = (state.currentTab - 1 + state.totalTabs) % state.totalTabs;
    state.optionIndex = 0;
    state.refresh();
    return true;
  }
  return false;
};

const handleSubmitTab = (
  state: questionnaireTypesTypes.QuestionnaireState,
  data: string,
): boolean => {
  if (state.currentTab !== state.questions.length) return false;

  if (matchesKey(data, Key.enter) && allAnswered(state)) {
    submit(state, false);
  } else if (matchesKey(data, Key.escape)) {
    submit(state, true);
  }
  return true;
};

const handleOptionNavigation = (
  state: questionnaireTypesTypes.QuestionnaireState,
  data: string,
): boolean => {
  const options = currentOptions(state);

  if (matchesKey(data, Key.up)) {
    state.optionIndex = Math.max(0, state.optionIndex - 1);
    state.refresh();
    return true;
  }
  if (matchesKey(data, Key.down)) {
    state.optionIndex = Math.min(options.length - 1, state.optionIndex + 1);
    state.refresh();
    return true;
  }

  const question = currentQuestion(state);
  if (matchesKey(data, Key.enter) && question !== undefined) {
    const option = options[state.optionIndex];
    if (option === undefined) return true;

    if (option.isOther === true) {
      state.inputMode = true;
      state.inputQuestionId = question.id;
      state.editor.setText("");
      state.refresh();
      return true;
    }

    saveAnswer(state, question.id, option.value, option.label, false, state.optionIndex + 1);
    advanceAfterAnswer(state);
    return true;
  }

  if (matchesKey(data, Key.escape)) {
    submit(state, true);
  }
  return true;
};

const handleInput = (state: questionnaireTypesTypes.QuestionnaireState, data: string): void => {
  if (handleInputMode(state, data)) return;
  if (handleTabNavigation(state, data)) return;
  if (handleSubmitTab(state, data)) return;
  handleOptionNavigation(state, data);
};

const askQuestionnaire = (request: {
  readonly tui: tuiTypes.TUI;
  readonly theme: codingAgentTypes.Theme;
  readonly questions: questionnaireTypesTypes.Question[];
  readonly done: (result: questionnaireTypesTypes.QuestionnaireResult) => void;
}) => {
  const { tui, theme, questions, done } = request;
  const isMulti = questions.length > 1;

  const state: questionnaireTypesTypes.QuestionnaireState = {
    answers: new Map<string, questionnaireTypesTypes.Answer>(),
    cachedLines: undefined,
    currentTab: 0,
    done,
    editor: new Editor(tui, editorTheme(theme)),
    inputMode: false,
    inputQuestionId: null,
    isMulti,
    optionIndex: 0,
    questions,
    refresh: () => {
      state.cachedLines = undefined;
      tui.requestRender();
    },
    totalTabs: questions.length + 1,
  };

  state.editor.onSubmit = (value) => {
    if (state.inputQuestionId === null || state.inputQuestionId.length === 0) return;
    const trimmed = value.trim() || "(no response)";
    saveAnswer(state, state.inputQuestionId, trimmed, trimmed, true);
    state.inputMode = false;
    state.inputQuestionId = null;
    state.editor.setText("");
    advanceAfterAnswer(state);
  };

  return {
    handleInput: (data: string) => handleInput(state, data),
    invalidate: () => {
      state.cachedLines = undefined;
    },
    render: (width: number) => renderQuestionnaire({ state, theme, width }),
  };
};

const questionnaireUi = {
  askQuestionnaire,
};

export default questionnaireUi;
