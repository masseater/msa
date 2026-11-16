# Examples

Example code for the msa-coding-agent SDK, process integration, and extensions.

## CLI integration

[`rpc-client.ts`](../examples/rpc-client.ts) uses the typed `RpcClient` to run msa in a child process, stream events, and wait for the run to settle.

Build the coding-agent package before running it from a repository checkout:

```bash
node examples/rpc-client.ts "Explain this repository"
```

## Directories

### [sdk/](../examples/sdk)

Programmatic usage via `createAgentSession()`. Shows how to customize models, prompts, tools, extensions, and session management.

### [extensions/](../examples/extensions)

Example extensions demonstrating:

- Lifecycle event handlers (tool interception, safety gates, context modifications)
- Custom tools (todo lists, questions, subagents, output truncation)
- Commands and keyboard shortcuts
- Custom UI (footers, headers, editors, overlays)
- Git integration (checkpoints, auto-commit)
- System prompt modifications and custom compaction
- External integrations (SSH, file watchers, system theme sync)
- Custom providers (Anthropic with custom streaming, GitLab Duo)

## Documentation

- [SDK Examples](./sdk-examples.md)
- [CLI Integration](./cli-integration.md)
- [Extensions Documentation](./extensions.md)
- [Skills Documentation](./skills.md)
