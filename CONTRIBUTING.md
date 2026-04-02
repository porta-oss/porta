# Contributing to Porta

Thank you for your interest in contributing to Porta! This guide covers local setup, verification, and PR expectations.

> **Alpha notice:** Porta is in public alpha. APIs, schemas, and behavior may change between releases. Community contributions are welcome, but expect breaking changes.

## Support Model

Porta is a **community-supported** project. There is no paid support tier.

- **Questions and help:** Use [GitHub Discussions](../../discussions) (Q&A category) or join our [Discord](https://discord.gg/porta).
- **Bug reports:** Open a [GitHub issue](../../issues/new?template=bug_report.yml).
- **Feature requests:** Open a [GitHub issue](../../issues/new?template=feature_request.yml).
- **Security vulnerabilities:** See [SECURITY.md](SECURITY.md) — **do not** open a public issue.

## Local Setup

### Prerequisites

- [Bun](https://bun.sh/) ≥ 1.1
- [Node.js](https://nodejs.org/) ≥ 20 (for the worker runtime)
- [Docker](https://www.docker.com/) (for Postgres and Redis)
- [pnpm](https://pnpm.io/) ≥ 9

### Getting Started

```bash
# Clone the repo
git clone https://github.com/nicholasgriffintn/porta.git
cd porta

# Install dependencies
pnpm install

# Start Postgres and Redis
pnpm services:up

# Copy environment config
cp .env.example .env
# Edit .env — at minimum set BETTER_AUTH_SECRET and CONNECTOR_ENCRYPTION_KEY

# Run database migrations
bun run --cwd apps/api db:migrate

# Start the dev servers (API + Web)
pnpm dev
```

The API runs at `http://localhost:3000` and the web app at `http://localhost:5173`.

### Running the Worker

The background worker (connector sync, insight generation) runs separately:

```bash
pnpm dev:worker
```

## Verification

Before submitting a PR, run these checks locally:

```bash
# Type checking
pnpm lint

# Unit and integration tests
pnpm test

# Code formatting (auto-fix)
pnpm fix

# Code formatting (check only)
pnpm check
```

All checks must pass. CI runs the same commands on every pull request.

## Pull Request Guidelines

1. **One concern per PR.** Keep changes focused — a bug fix, a feature, or a refactor, not all three.
2. **Write tests.** New features need tests. Bug fixes need a regression test.
3. **Follow existing patterns.** Read the surrounding code before introducing new abstractions.
4. **Update docs if needed.** If your change affects setup, configuration, or public behavior, update the relevant docs.
5. **Keep commits clean.** Use clear commit messages. Squash fixup commits before requesting review.

### Code Style

This project uses [Ultracite](https://github.com/haydenbleasel/ultracite) (Biome) for formatting and linting. Run `pnpm fix` to auto-format before committing.

Key conventions:
- ESM only (`.ts` extensions in imports)
- Strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
- `import type` for type-only imports
- Arrow functions for callbacks
- `const` by default, `let` only when reassignment is needed

### Project Structure

```
apps/
  api/       — Fastify API server
  web/       — React + Vite frontend
  worker/    — BullMQ background worker (Node runtime)
packages/
  shared/    — Shared types and contracts
```

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [AGPLv3 License](LICENSE).
