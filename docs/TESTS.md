# Kaboo Backend – Test Guide

## 1. Test Requirements

### 1.1 Tooling
- Deno installed (for backend/unit/E2E tests)
- Supabase CLI and a Supabase project (for live backend + DB)
- PostgreSQL is provided automatically when you run `supabase start`

### 1.2 Environment Variables

Backend tests assume a real Supabase project with these variables configured:

- `SUPABASE_URL` – project URL
- `SUPABASE_ANON_KEY` – anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` – service role key (required for secure tables)

Optional but recommended for multiplayer / profile tests:

- `TEST_USER_EMAILS` – comma-separated test emails  
  - e.g. `TEST_USER_EMAILS=alice@example.com,bob@example.com,charlie@example.com`
- `TEST_USER_PASSWORD` – shared password for all `TEST_USER_EMAILS`
- Or per-user variants:
  - `TEST_USER_EMAILS_A=alice@example.com` + `TEST_USER_PASSWORD_A=...`
  - `TEST_USER_EMAILS_B=bob@example.com` + `TEST_USER_PASSWORD_B=...`

These values are read by [`supabase/functions/tests/testUtils.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/testUtils.ts).

### 1.3 Seeding Test Users

If you use email/password test users, seed them once:

```bash
deno run --allow-env --allow-net --env=.env \
  supabase/scripts/seed-test-users.ts
```

This script:
- Reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_USER_EMAILS`, `TEST_USER_PASSWORD`
- Creates/ensures those users exist via Supabase Auth Admin API

### 1.4 Local Supabase (optional)

For full local runs (DB + functions):

```bash
supabase start
supabase functions serve
```

Then point `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` at your local or remote project accordingly.

---

## 2. How to Run Tests

All commands are run from `kaboo-be/`.

### 2.1 Core Game Engine (pure logic)

Low-level game engine simulations (no network required):

```bash
deno test --allow-env --allow-read \
  supabase/functions/_shared/simulation.test.ts
```

### 2.2 Backend E2E Suites (Supabase-backed)

These tests hit real Edge Function handlers and the database.  
They are automatically **ignored** if Supabase env vars are missing or placeholders.

#### 2.2.1 Core flow & invariants

```bash
deno test --allow-env --allow-read --allow-net \
  supabase/functions/tests/core
```

Covers:
- Starting games and verifying deck/discard/hand invariants
- `get-game-state` happy path and edge cases
- `toggle-ready`, `kick-player`, and `update-settings` behavior

#### 2.2.2 Effects / scoring (peek, spy, etc.)

```bash
deno test --allow-env --allow-read --allow-net \
  supabase/functions/tests/effects
```

Covers:
- Effect cards:
  - 7 (`PEEK_OWN`)
  - 9 (`PEEK_OTHER` / `SPY_OPPONENT`)
- Ensures the game:
  - Transitions into effect phases correctly
  - Resolves effects and resumes normal play

#### 2.2.3 Lobby / lifecycle flows

```bash
deno test --allow-env --allow-read --allow-net \
  supabase/functions/tests/lobby
```

Covers:
- `create-game`, `join-game`, `toggle-ready`, `start-game`, `leave-game`
- Full lifecycle: Create → Join → Start → Leave → End
- Join rules and negative cases:
  - Max players respected
  - Invalid room codes
  - Duplicate joins and edge behaviors

#### 2.2.4 Profile endpoints

```bash
deno test --allow-env --allow-read --allow-net \
  supabase/functions/tests/profile
```

Covers:
- `get-profile` and `update-profile`
- Auth header requirements
- Invalid/expired token handling
- Profile history integration with games played

#### 2.2.5 Backend E2E “glue” tests

```bash
deno test --allow-env --allow-read --allow-net \
  supabase/functions/tests/backend_e2e.test.ts
```

Covers:
- A compact end-to-end lifecycle test:
  - Create → Join → Start → Leave → End
- Error flows such as:
  - Only the host can end a game
  - Only players in the game can interact with it

> Note: Most of this coverage is now split into `core/`, `lobby/`, `game/`, and `effects/` files.  
> The `backend_e2e.test.ts` file is intentionally small and acts as a sanity check.

### 2.3 Game Logic Unit Tests (non-Supabase)

These tests validate helper logic around end/leave-game rules without Supabase:

```bash
deno test --allow-read \
  supabase/functions/tests/game/end-game-logic.test.ts \
  supabase/functions/tests/game/leave-game-logic.test.ts
```

Covers:
- Who is allowed to end a game
- When a game should be deleted
- Host migration when the host leaves

---

## 3. Test Coverage Overview

This section summarizes what each backend test area covers.

### 3.1 Core Logic & State

Files:
- [`supabase/functions/_shared/simulation.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/_shared/simulation.test.ts)
- [`supabase/functions/tests/core/kaboo-and-game-state.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/core/kaboo-and-game-state.test.ts)
- [`supabase/functions/tests/core/get-game-state-edge-cases.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/core/get-game-state-edge-cases.test.ts)

Covers:
- Full Kaboo round flows:
  - Ready-up
  - Calling KABOO
  - Final-round turn progression
- Deck/hand/discard invariants after `start-game`
- `get-game-state`:
  - Normal responses (sanitized state for the caller)
  - Missing or empty `game_state` → default lobby state
  - Access control when the caller is not in the game

### 3.2 Effects & Scoring

Files:
- [`supabase/functions/tests/effects/peek-effects.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/effects/peek-effects.test.ts)

Covers:
- `SET_TEST_DECK` helper behavior in E2E context
- 7-effect:
  - Drawing and discarding to trigger `PEEK_OWN`
  - Resolving `PEEK_OWN` and returning to normal play
- 9-effect:
  - Triggering `PEEK_OTHER` / `SPY_OPPONENT`
  - Choosing target players and card indices
  - Ensuring the effect is cleared and turn phase goes back to `draw`

### 3.3 Lobby & Multiplayer Flows

Files:
- [`supabase/functions/tests/lobby/lifecycle-full.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/lobby/lifecycle-full.test.ts)
- [`supabase/functions/tests/lobby/lobby-join-behavior.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/lobby/lobby-join-behavior.test.ts)
- [`supabase/functions/tests/lobby/lobby-negative-host-permissions.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/lobby/lobby-negative-host-permissions.test.ts)

Covers:
- Creation of lobbies with `create-game`
- Joining with `join-game`:
  - Normal joins
  - Max player constraints
  - Invalid room codes
- Toggling ready state and starting games
- Permissions around host actions (e.g. only host can start, kick, update settings)

### 3.4 Profile & History

Files:
- [`supabase/functions/tests/profile/profile-auth-header.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/profile/profile-auth-header.test.ts)
- [`supabase/functions/tests/profile/profile-invalid-token.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/profile/profile-invalid-token.test.ts)
- [`supabase/functions/tests/profile/profile-e2e.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/profile/profile-e2e.test.ts)

Covers:
- Authentication requirements for profile endpoints
- Behavior when no or invalid tokens are provided
- End-to-end profile usage:
  - Creating games as a user
  - Fetching profile and match history

### 3.5 Game API & Actions

Files:
- [`supabase/functions/tests/game/create-game.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/game/create-game.test.ts)
- [`supabase/functions/tests/game/start-game.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/game/start-game.test.ts)
- [`supabase/functions/tests/game/end-game-logic.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/game/end-game-logic.test.ts)
- [`supabase/functions/tests/game/leave-game-logic.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/game/leave-game-logic.test.ts)

Covers:
- `create-game` invariants:
  - Games persisted in `games`
  - Host player stored in `game_players`
  - Secrets row created in `game_secrets`
  - Multiple game creation by the same user uses unique IDs and room codes
- `start-game` preconditions (e.g. minimum players)
- End/leave logic at a rule level:
  - Host-only end-game
  - When games should be deleted (no players)
  - Host migration when host leaves

### 3.6 Integration / Glue Tests

File:
- [`supabase/functions/tests/backend_e2e.test.ts`](file:///e:/Code/kaboo/kaboo-be/supabase/functions/tests/backend_e2e.test.ts)

Covers:
- A compact “does everything work together” flow for the main endpoints:
  - `create-game`, `join-game`, `toggle-ready`, `start-game`, `leave-game`, `end-game`
- Additional error handling and edge cases not covered by more focused files

---

## 4. Notes and Future Work

- Many tests are guarded with `ignore: !hasSupabaseEnv || !hasServiceRoleKey`:
  - They act as fast no-ops when env is missing
  - In CI or a properly configured local environment, they run as full E2E tests
- Frontend test plans (Vitest + real Supabase) live separately in:  
  [`kaboo-fe/docs/REAL_API_TESTS.md`](file:///e:/Code/kaboo/kaboo-fe/docs/REAL_API_TESTS.md)
- If you add new Edge Functions, prefer:
  - Unit tests in `_shared/` when possible
  - Focused E2E tests in `supabase/functions/tests/<area>/`
  - Keep `backend_e2e.test.ts` small and scenario-oriented, not a dumping ground.

