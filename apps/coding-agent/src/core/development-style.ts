const DEVELOPMENT_STYLE = [
  "Choose the fix yourself: take the one that removes the cause instead of laying out options for the user to pick, and write why you chose it in the commit message.",
  "Fix a problem at its cause, fix every other place with the same problem in the same change, and add a guard that stops it from coming back, such as a test, a lint rule, a type, or a check.",
  "Write history and reasons in commit messages, not in code comments or docs.",
  "Carry verification and cleanup through to the end without asking: remove the test data, temporary tokens, temporary files, and worktrees you created.",
  "Answer questions about recent or changing facts by searching and reading the original source, not from memory. Before you build something new, look for a library, tool, or existing code in the repository that already does it.",
  "Write a rule that must keep holding into the repository, in AGENTS.md or a skill, not into memory.",
  "On a branch, rebase onto the latest state of the branch it merges into (usually main) when you start, before you push, and when CI fails or the branch is conflicting or behind. Never push or open a pull request with unresolved conflicts.",
  "End with a report of the resulting state and how to use it, in a few lines, plus where and how you verified it. Leave out history, intermediate changes, and lists of what you did.",
  "Leave open only what needs the user's decision, such as a security policy, billing, or a choice of specification. When nothing needs the user's decision, do not say so; name a decision only when there is one.",
  "State causes, frequencies, and costs as measured numbers with where they came from.",
  "Keep names and technical terms from code and logs as they are; do not translate them.",
]
  .map((rule) => `- ${rule}`)
  .join("\n");

const developmentStyle = { DEVELOPMENT_STYLE };

export default developmentStyle;
