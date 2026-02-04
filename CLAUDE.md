**Before reading further:** Open `WORKING_AGREEMENT.md` and follow its commitments. It contains mandatory guardrails (no speculation, every claim tied to logs/tests, flag outstanding verification) that apply to every task in this repo.

# Claude Code Instructions

## CRITICAL RULE: SERVICE MANAGEMENT
**NEVER start, stop, restart, or kill any services (backend, frontend, databases, etc.) without EXPLICIT user permission.**
- DO NOT use `node server/index.js`, `npm run dev`, or any service management commands
- DO NOT kill background processes unless explicitly instructed
- If you believe a service needs to be restarted, **ASK THE USER FIRST**
- This applies to ALL services: backend servers, frontend dev servers, etc.

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## Code Quality Rules

### TypeScript Best Practices
- Use strict TypeScript typing (avoid 'any' unless justified)
- Prefer interfaces over type aliases for object shapes
- Use proper error handling with typed errors
- Follow React hooks rules and patterns

### Component Guidelines
- Keep components focused and single-responsibility
- Use composition over inheritance
- Prefer controlled components
- Extract reusable logic into custom hooks

### Testing Expectations
- Run `npm run typecheck` before committing
- Verify changes don't break existing functionality
- Test both happy paths and error cases
