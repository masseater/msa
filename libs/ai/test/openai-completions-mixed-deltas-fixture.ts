import openaiCompletionsToolChoiceMock from "./openai-completions-tool-choice-mock.ts";

const { mockState } = openaiCompletionsToolChoiceMock;

const mixedDeltaChunks: typeof mockState.chunks = [
  {
    choices: [
      {
        delta: {
          content: "answer 1",
          reasoning_content: "think 1",
          tool_calls: [
            {
              function: { arguments: '{"path":"README', name: "read" },
              id: "tc_read_initial",
              index: 0,
              type: "function",
            },
            {
              function: { arguments: '{"pattern":"TODO', name: "grep" },
              id: "tc_grep_initial",
              index: 1,
              type: "function",
            },
            {
              function: { arguments: '{"path":"packages', name: "list" },
              id: "tc_list_no_index",
              type: "function",
            },
            {
              function: { arguments: '{"path":"out', name: "write" },
              id: "tc_write_no_index",
              type: "function",
            },
          ],
        },
        finish_reason: null,
      },
    ],
    id: "chatcmpl-mixed-deltas",
  },
  {
    choices: [
      {
        delta: {
          content: " answer 2",
          tool_calls: [
            {
              function: { arguments: '","path":"src' },
              id: "tc_grep_changed",
              index: 1,
              type: "function",
            },
            {
              function: { arguments: '.txt","content":"ok"}' },
              id: "tc_write_no_index",
              type: "function",
            },
            {
              function: { arguments: '/ai"}' },
              id: "tc_list_no_index",
              type: "function",
            },
          ],
        },
        finish_reason: null,
      },
    ],
    id: "chatcmpl-mixed-deltas",
  },
  {
    choices: [
      {
        delta: {
          content: "\n",
          reasoning_content: " think 2",
          tool_calls: [
            {
              function: { arguments: '.md"}' },
              id: "tc_read_changed",
              index: 0,
              type: "function",
            },
            {
              function: { arguments: '"}' },
              index: 1,
              type: "function",
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    id: "chatcmpl-mixed-deltas",
    usage: {
      completion_tokens: 8,
      completion_tokens_details: { reasoning_tokens: 2 },
      prompt_tokens: 10,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  },
];

export default mixedDeltaChunks;
