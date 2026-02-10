# Kaboo Backend

A high-performance, secure backend for the Kaboo card game, built with **Supabase Edge Functions**, **Deno**, and **PostgreSQL**.

## Features

*   **Serverless Architecture**: Logic runs on Supabase Edge Functions (Deno).
*   **Secure State**: Game state is stored in a secure table (`game_secrets`), inaccessible to clients directly.
*   **Realtime**: "Signal-then-Fetch" architecture ensures low latency updates with maximum security.
*   **Game Logic**: Full implementation of Kaboo rules, including card effects, snapping, and scoring.

## Getting Started

### Prerequisites

*   [Supabase CLI](https://supabase.com/docs/guides/cli) installed.
    *   If you don't want to install it globally, you can use `npx supabase` in the commands below.
*   [Deno](https://deno.land/) installed (optional, for local testing).

### Setup

1.  **Clone the repository**
    ```bash
    git clone <repo-url>
    cd kaboo-be
    ```

2.  **Configure Environment**
    Copy the example environment file and fill in your Supabase credentials.
    ```bash
    cp .env.example .env
    ```
    *   `SUPABASE_URL`: Your project URL.
    *   `SUPABASE_ANON_KEY`: Public anonymous key.
    *   `SUPABASE_SERVICE_ROLE_KEY`: **Required** for Edge Functions to access secure state.

3.  **Link Project**
    Link your local project to your remote Supabase project. You will need your Project ID (found in Project Settings).
    ```bash
    # If Supabase CLI is installed globally:
    supabase link --project-ref <your-project-id>
    
    # Or using npx:
    npx supabase link --project-ref <your-project-id>
    ```

4.  **Deploy Database**
    Push the migrations to your remote Supabase project.
    ```bash
    supabase db push
    # OR
    npx supabase db push
    ```
    *This creates the `games`, `game_players`, and `game_secrets` tables along with RLS policies.*

5.  **Deploy Functions**
    Deploy the Deno Edge Functions.
    ```bash
    supabase functions deploy
    # OR
    npx supabase functions deploy
    ```

## CI/CD

This project includes a GitHub Action to automatically deploy Edge Functions when changes are pushed to the `main` or `master` branch.

### Setup

To enable the deployment workflow, you need to add the following **Repository Secrets** in your GitHub repository settings (`Settings` > `Secrets and variables` > `Actions`):

*   `SUPABASE_ACCESS_TOKEN`: Your Supabase Personal Access Token. You can generate one [here](https://supabase.com/dashboard/account/tokens).
*   `SUPABASE_PROJECT_ID`: The Reference ID of your Supabase project (e.g., `abcdefghijklm`).

The workflow file is located at `.github/workflows/deploy-supabase-functions.yml`.

## Development

### Running Tests
The core game logic is fully unit-tested using Deno's built-in test runner.

```bash
deno test --allow-env --allow-read supabase/functions/_shared/simulation.test.ts
```

### Local Development
To run functions locally (requires Docker):
```bash
supabase start
supabase functions serve
```

## Documentation

*   **[API Documentation](docs/API.md)**: Detailed guide on endpoints, request/response formats, and Realtime integration.
*   **[Realtime Guide](docs/REALTIME_AND_EVENTS.md)**: Subscription patterns and event handling.

## Project Structure

*   `supabase/functions/`: Edge Functions source code.
    *   `_shared/`: Shared game logic (`game-rules.ts`) and types.
    *   `create-game/`: Room creation.
    *   `play-move/`: Main game loop and action processing.
    *   `get-game-state/`: Secure state retrieval.
*   `supabase/migrations/`: Database schema definitions (SQL).

## License

Distributed under the MIT License. Copyright (c) 2026 Warid (https://github.com/Warid27). See `LICENSE` for more information.
