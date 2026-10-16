# msa

msa is a minimal, extensible agent harness, forked from [pi](https://github.com/earendil-works/pi)
and maintained under its own name, package scope, and config directory.

Adapt msa to your workflows, not the other way around. Customize msa with
[extensions](packages/coding-agent/docs/extensions.md), [skills](packages/coding-agent/docs/skills.md),
[prompt templates](packages/coding-agent/docs/prompt-templates.md), and
[themes](packages/coding-agent/docs/themes.md). Bundle them as
[msa packages](packages/coding-agent/docs/packages.md) and share via npm or git.

msa ships with powerful defaults but skips features like sub-agents and plan mode. Ask msa to build
what you want, or install a package that does it your way.

Use msa [interactively](packages/coding-agent/docs/usage.md), automate it in
[print or JSON mode](packages/coding-agent/docs/cli.md), control it over
[RPC](packages/coding-agent/docs/rpc.md), or build apps with the
[msa TypeScript SDK](packages/coding-agent/docs/sdk.md).

## Getting started

This fork is not published to npm, and the pi.dev installer installs upstream pi, so run msa from a
checkout:

```bash
git clone https://github.com/masseater/msa.git
cd msa
vp install
./scripts/msa-dev.sh
```

Node.js 22.19 or newer is required. State lives in `~/.msa/agent`, next to `settings.json`,
`auth.json`, and sessions.

Run `/login` inside msa to connect a subscription or API key, then give msa a task.

Extensions written for pi keep loading: `@earendil-works/pi-*` imports resolve to the bundled
packages, and a `package.json` `"pi"` manifest is still read. Values that identify the client to
external services (the `pi/<version>` User-Agent, pi.dev endpoints, the Codex and xAI login
identifiers) intentionally keep the pi name, because those services know the client by it.

## Packages

This monorepo contains the msa CLI and its supporting libraries.

| Package                                        | Description                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **[@msa/chord](packages/chord)**               | Typed host runtime for hot-reloadable plugins, contracts, replicated state, and RPC over JSON links |
| **[@msa/telemetry](packages/telemetry)**       | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas         |
| **[@msa/ai](packages/ai)**                     | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.)                                    |
| **[@msa/durable](packages/durable)**           | Durable conversation, task, and document runtime                                                    |
| **[@msa/agent-core](packages/agent)**          | Agent runtime with tool calling and state management                                                |
| **[@msa/coding-agent](packages/coding-agent)** | Interactive coding agent CLI                                                                        |
| **[@msa/tui](packages/tui)**                   | Terminal UI library with differential rendering                                                     |

## Permissions & Containerization

msa does not include a built-in permission system for restricting filesystem, process, network, or
credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox msa. See
[packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for
three patterns:

- **Gondolin extension**: keep `msa` and provider auth on the host while routing built-in tools and
  `!` commands into a local Linux micro-VM.
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

### Using local packages outside the monorepo

Build every public package into one coherent local artifact set:

```bash
vp run pack:packages -- --out .artifacts/msa-packages
```

This refreshes model data before building `@msa/ai`. To avoid network access when model data is
already hydrated, pass `--offline-model-data`.

Then configure an external project to consume one package and resolve all of its msa dependencies
from the same artifact set. npm is the default:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/msa-packages/manifest.json \
  --consumer ../my-project \
  --package @msa/durable \
  --package @msa/agent-core
cd ../my-project
npm install --ignore-scripts
```

For a pnpm project, point `--consumer` at the workspace root:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/msa-packages/manifest.json \
  --consumer ../my-project \
  --package @msa/agent-core \
  --package-manager pnpm
cd ../my-project
pnpm install --ignore-scripts
```

Repeat `--package` for each direct dependency. The command updates the consumer's `package.json`
with content-addressed local `file:` references. It writes transitive overrides to `package.json`
for npm or `pnpm-workspace.yaml` for pnpm. Keep the artifact directory available while installing
or updating the consumer. Re-run both commands after changing msa source.

## License

MIT. msa is a fork of [pi](https://github.com/earendil-works/pi), which this project gratefully
builds on.
