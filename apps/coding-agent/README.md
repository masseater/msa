# msa

msa is a minimal, extensible agent harness that you can make your own. It is a fork of
[pi](https://github.com/earendil-works/pi), maintained under its own name, package scope, and
config directory.

Adapt msa to your workflows, not the other way around. Customize msa with
[extensions](docs/extensions.md), [skills](docs/skills.md),
[prompt templates](docs/prompt-templates.md), and [themes](docs/themes.md). Bundle them as
[msa packages](docs/packages.md) and share via npm or git.

msa ships with powerful defaults but skips features like sub-agents and plan mode. Ask msa to
build what you want, or install a package that does it your way.

Use msa [interactively](docs/usage.md), automate it in
[print or JSON mode](docs/cli.md), control it over [RPC](docs/rpc.md), or build apps with the
[msa TypeScript SDK](docs/sdk.md). See [OpenClaw](https://github.com/OpenClaw/OpenClaw) for a
real-world integration.

## Getting started

This fork is not published to npm, so run msa from a checkout:

```bash
git clone https://github.com/masseater/msa
cd msa
vp install
./scripts/msa-dev.sh
```

msa requires Node.js 22.19 or newer. State lives in `~/.msa/agent`.

Start msa in the directory where you want it to work:

```bash
cd /path/to/project
/path/to/msa/scripts/msa-dev.sh
```

For a built-in AI provider, run `/login` inside msa to connect a subscription or API key. Then
give msa a task.

See the [documentation](docs/index.md) for full setup and usage instructions.

## Development

`scripts/msa-dev.sh` can be called from any directory and preserves the caller's working
directory.

Before submitting changes, run from the repository root:

```bash
vp run verify   # lint, type check, tests, model data check
./test.sh       # tests (skips LLM-dependent tests without API keys)
```

## License

MIT
