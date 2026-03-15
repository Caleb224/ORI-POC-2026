# Effect + XState + Encore Policy POC

This repository is a proof-of-concept insurance policy workflow built to show how
Effect, XState, and Encore complement each other in a real backend + frontend flow.
It includes a minimal dashboard, typed Effect-based services, explicit workflow rules,
and a Postgres-backed repository.

**What this POC demonstrates**
1. A quote workflow enforced by XState before a policy can be approved or declined.
2. An issued-policy lifecycle with an "inactive" state when coverage ends.
3. Effect-powered repository and service layers with typed errors and timing-aware logs.
4. Encore APIs with built-in routing, cron jobs, and CORS configuration.

**Status model**
1. Quote workflow: `quoted -> approved | declined`
2. Lifecycle workflow: `approved -> active | inactive` (inactive if coverage already ended)
3. Auto-inactivation: `active -> inactive` when `end_date` is on or before today's UTC date

## Architecture

**Request flow**
1. Encore API handlers receive HTTP requests in `src/api`.
2. Handlers call Effect-based business logic in `src/logic/policy_logic.ts`.
3. Business logic uses XState machines from `src/machines` to validate transitions.
4. Repositories in `src/repositories` map DB rows to domain models.
5. The Database service in `src/services/database.ts` is injected via Effect layers.

**Key modules**
1. `src/api/policies.ts`  
   Encore HTTP endpoints and a daily cron job to expire policies.
2. `src/logic/policy_logic.ts`  
   Validation rules, transition checks, and orchestrated repository effects.
3. `src/machines/policy_quote_machine.ts`  
   Quote workflow machine.
4. `src/machines/policy_lifecycle_machine.ts`  
   Issued-policy lifecycle machine (active/inactive).
5. `src/repositories/base_repository.ts`  
   Generic create/update/read/delete helpers.
6. `src/repositories/policy_repository.ts`  
   Policy-specific persistence and row normalization.
7. `src/layers/database_layer.ts`  
   Postgres connection pool with timing-aware error logs.
8. `frontend/src/routes/index.tsx`  
   Minimal dashboard for quoting and state transitions.

## Why these tools

**Effect**
1. Typed errors let us make failure cases explicit across the stack.
2. Layers provide dependency injection without globals or manual wiring.
3. `Effect.timed` gives precise duration metrics for DB errors.
4. The test harness can swap real DBs with mock layers easily.

**XState**
1. Workflow rules are explicit, testable, and visualizable.
2. Invalid transitions are blocked consistently in one place.
3. It prevents "hidden rules" scattered across handlers or UI.

**Encore**
1. Service topology and API wiring are simple and explicit.
2. Local dev feels like production, including cron jobs and traces.
3. CORS is centralized in `encore.app`.

## Getting the project running locally

### Prerequisites
1. Node.js and `pnpm` (repo uses `pnpm` for scripts).
2. Docker (for Postgres).
3. Encore CLI (`encore`).

### Install dependencies
1. Backend dependencies:
   `pnpm install`
2. Frontend dependencies:
   `pnpm --dir frontend install`

### Start Postgres
1. `docker compose up -d`

### Seed the database
1. `docker exec -i effectplayground-postgres psql -U postgres -d effectplayground < sql/seed.sql`

### Run the backend (Encore)
1. `DATABASE_URL=postgres://postgres:postgres@localhost:5432/effectplayground encore run`

This starts the API on `http://127.0.0.1:4000`.

### Run the frontend
1. `pnpm --dir frontend dev`

The UI runs at `http://localhost:3000`.

### Optional frontend API base
The frontend defaults to `http://127.0.0.1:4000`.
If you need to point to a different API base:
1. `VITE_API_BASE_URL=http://127.0.0.1:4000 pnpm --dir frontend dev`

### CORS
Allowed origins are configured in `encore.app`:
1. `http://localhost:3000`
2. `http://127.0.0.1:3000`

## Testing and linting

1. Lint the whole project: `pnpm lint`
2. Run all tests: `pnpm test`
3. Backend-only tests: `pnpm test:backend`

## Workflow automation (auto-inactivation)

Encore runs a daily cron job at **00:00 UTC** that transitions eligible policies
from `active` to `inactive` when the policy `end_date` is on or before the current
UTC date. The job is defined in `src/api/policies.ts`.

## Troubleshooting

**Access denied from Encore**
1. Run `encore auth login`
2. Ensure you have access to the app id in `encore.app`

**No policies appearing in the UI**
1. Confirm `encore run` is running and the API responds to `/policies`.
2. Verify the database is seeded and `DATABASE_URL` is correct.
3. Check the browser console for network or CORS errors.

**Database errors**
1. Confirm Docker is running and Postgres is reachable on port 5432.
2. Verify the `effectplayground-postgres` container is healthy.

