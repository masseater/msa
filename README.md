# msa

msa is masseater's agent harness: an opinionated coding agent built around how [masseater](https://github.com/masseater) works. It started as a fork of [pi](https://github.com/earendil-works/pi), but it is now a completely separate project with its own name, package scope, config directory, and direction. pi is not msa's upstream.

## Direction

- **Not minimal.** pi keeps its core small and leaves features to extensions. msa does the opposite: a feature that proves useful goes into the core, on by default, instead of living in an extension you have to find and install. `/goal`, for example, is built in.
- **masseater style.** Defaults, commands, and workflows follow masseater's habits. Claude Code is the reference for command names and behavior, so moving between the two needs no relearning.
- **pi extensions keep working.** Extensions written for pi load as they are: `@earendil-works/pi-*` imports resolve to the bundled packages, and a `package.json` `"pi"` manifest is still read. When an extension turns out to be worth having for everyone, msa absorbs it into the core.
- **pi is not an upstream.** msa does not follow, track, or merge pi. When a pi feature is judged worth having, msa takes it in feature by feature and implements it in msa's own way. pi code is never copied in as is.

Planned work lives in the [issues](https://github.com/masseater/msa/issues).

You can still customize msa with [extensions](apps/coding-agent/docs/extensions.md), [skills](apps/coding-agent/docs/skills.md), [prompt templates](apps/coding-agent/docs/prompt-templates.md), and [themes](apps/coding-agent/docs/themes.md), and bundle them as [msa packages](apps/coding-agent/docs/packages.md) to share via npm or git.

Use msa [interactively](apps/coding-agent/docs/usage.md), automate it in [print or JSON mode](apps/coding-agent/docs/cli.md), control it over [RPC](apps/coding-agent/docs/rpc.md), or build apps with the [msa TypeScript SDK](apps/coding-agent/docs/sdk.md).

## Getting started

msa is not published to npm, and the pi.dev installer installs pi, so install msa with [Homebrew](https://github.com/masseater/homebrew-tap), from a [release](https://github.com/masseater/msa/releases/latest), or run it from a checkout:

```bash
brew install masseater/tap/msa
```

Or download and extract a release archive directly:

```bash
curl -fsSLO https://github.com/masseater/msa/releases/latest/download/msa-darwin-arm64.tar.gz
tar -xzf msa-darwin-arm64.tar.gz
./msa/msa
```

Releases ship `msa-darwin-arm64.tar.gz`, `msa-darwin-x64.tar.gz`, `msa-linux-x64.tar.gz`, `msa-linux-arm64.tar.gz`, `msa-windows-x64.zip`, `msa-windows-arm64.zip`, and `SHA256SUMS`. On Windows, unzip the archive and run `msa.exe`.

To run from a checkout instead:

```bash
git clone https://github.com/masseater/msa.git
cd msa
vp install
./scripts/msa-dev.sh
```

The checkout requires Node.js 22.19 or newer. State lives in `~/.msa/agent`, next to `settings.json`, `auth.json`, and sessions.

Run `/login` inside msa to connect a subscription or API key, then give msa a task.

Values that identify the client to external services (the `pi/<version>` User-Agent, pi.dev endpoints, the Codex and xAI login identifiers) intentionally keep the pi name, because those services know the client by it.

## Packages

This monorepo contains the msa CLI and its supporting libraries.

| Package                                    | Description                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **[@msa/chord](libs/chord)**               | Typed host runtime for hot-reloadable plugins, contracts, replicated state, and RPC over JSON links |
| **[@msa/telemetry](libs/telemetry)**       | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas         |
| **[@msa/ai](libs/ai)**                     | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.)                                    |
| **[@msa/durable](libs/durable)**           | Durable conversation, task, and document runtime                                                    |
| **[@msa/agent-core](libs/agent)**          | Agent runtime with tool calling and state management                                                |
| **[@msa/coding-agent](apps/coding-agent)** | Interactive coding agent CLI                                                                        |
| **[@msa/tui](libs/tui)**                   | Terminal UI library with differential rendering                                                     |

## Permissions & Containerization

msa does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox msa. See [apps/coding-agent/docs/containerization.md](apps/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `msa` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `msa` process in a local container for simple isolation.
- **OpenShell**: run the whole `msa` process in a policy-controlled sandbox.

## Development

```bash
vp install            # Install all dependencies
vp run build          # Refresh model data, then build all packages
vp run verify         # Lint, type check, tests, model data check, fence ratchet
./test.sh             # Run tests (skips LLM-dependent tests without API keys)
./scripts/msa-dev.sh  # Run msa from sources (can be run from any directory)
```

### Release binaries

`vp run build-binaries` builds `msa` for every release platform into `.artifacts/binaries` (`msa-<platform>.tar.gz`, `msa-<platform>.zip`, and `SHA256SUMS`). Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds them in CI, smoke-tests the result, and publishes a GitHub Release. `vp run render-homebrew-formula` renders `Formula/msa.rb` from `SHA256SUMS` into `.artifacts/homebrew`; the workflow pushes it to [masseater/homebrew-tap](https://github.com/masseater/homebrew-tap) once the release is published.

## License

MIT. msa started as a fork of [pi](https://github.com/earendil-works/pi), which this project gratefully builds on.
