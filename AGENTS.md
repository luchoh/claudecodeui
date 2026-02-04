# Repository Guidelines

**Before reading further:** Open `WORKING_AGREEMENT.md` and follow its commitments. It contains mandatory guardrails (no speculation, every claim tied to logs/tests, flag outstanding verification) that apply to every task in this repo.

## Project Structure & Module Organization

This is a web-based UI for Claude Code CLI, built with:
- **Frontend**: React + Vite in `src/`, with components, hooks, and utilities
- **Backend**: Express.js server in `server/`, handling API routes and WebSocket connections
- **Shared**: Common types and utilities in `shared/`
- **Static Assets**: Public files in `public/`

Key directories:
- `src/components/` - React components
- `src/hooks/` - Custom React hooks
- `src/lib/` - Utility functions and helpers
- `server/` - Express backend with authentication, database, and Claude CLI integration
- `shared/` - Types and constants shared between frontend and backend

## Build, Test, and Development Commands

- **Do not start or stop long-running services yourself.** The user manages backend and frontend lifecycles via `devenv up ...` or `npm run dev`; assume both are already running in development mode with auto-reload enabled.
- `npm run dev` starts both server and client with hot reload using concurrently
- `npm run server` runs only the Express backend
- `npm run client` runs only the Vite dev server
- `npm run build` creates a production build
- `npm run typecheck` runs TypeScript type checking

> **Service lifecycle rule**: Focus on code changes, tests, and diagnostics. Never run `devenv up`, `devenv down`, or similar orchestration commands unless the user explicitly instructs you to do so.

## Coding Style & Naming Conventions

- TypeScript throughout, with strict type checking
- React components use PascalCase filenames
- Hooks and utilities use camelCase
- Tailwind CSS for styling with `clsx`/`class-variance-authority` for conditional classes
- ESM modules (`"type": "module"` in package.json)

## Testing Guidelines

Run `npm run typecheck` to verify TypeScript compilation. Additional test suites should be added as the project matures.

## Commit & Pull Request Guidelines

Follow the existing history's imperative, sentence-case commit messages (`Add user authentication`). Keep the subject under ~72 characters and add focused bodies when explaining rationale or trade-offs. Pull requests should link issues, call out API changes, and include screenshots for UI adjustments.

## Local Environment Options

**devenv users** can enter the Nix shell via `devenv shell` (see below for details). Service processes source `.env.dev` from the repo root.

### Environment Setup

1. Create local profiles:
   ```bash
   cp .env.dev.example .env.dev
   ```

2. Enter the shell:
   ```bash
   devenv shell
   ```

3. Run services (managed by the user):
   - `devenv up server client` (sources `.env.dev`)
   - Or use `npm run dev` for the traditional workflow

## Security & Configuration Tips

Never commit secrets. Start from the tracked template:

- Local dev: `cp .env.dev.example .env.dev`

Add API keys and credentials as needed. Log files and database files should be gitignored; inspect them for sensitive data before sharing.
