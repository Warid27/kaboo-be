# Kaboo Backend API Documentation

## Architecture Overview

This backend is built on **Supabase** using **Edge Functions (Deno)** and **PostgreSQL**.

### Key Concepts
1.  **State Management**: Game state is stored in a secure `game_secrets` table, accessible only via Edge Functions (Service Role).
2.  **Security**: 
    *   **Row Level Security (RLS)** protects public tables (`games`, `game_players`).
    *   **Sanitization**: The `get-game-state` endpoint filters sensitive data (e.g., opponent cards, deck) before returning it to the client.
3.  **Realtime**: Uses a "Signal-then-Fetch" pattern.
    *   **Signal**: Clients subscribe to `postgres_changes` on the `games` table (`updated_at` column).
    *   **Fetch**: When a change is detected, clients call `get-game-state` to retrieve the latest sanitized state.

---

## Authentication

All endpoints require a standard Supabase Auth Bearer Token.
**Header**: `Authorization: Bearer <access_token>`

---

## Realtime Integration (Frontend Guide)

1.  **Subscribe** to the `games` table for your specific `gameId`.
    ```javascript
    const channel = supabase
      .channel('game_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          // Trigger a fetch when 'updated_at' changes
          fetchGameState();
        }
      )
      .subscribe();
    ```

2.  **Fetch** the state using the Edge Function.
    ```javascript
    const { data, error } = await supabase.functions.invoke('get-game-state', {
      body: { gameId },
    });
    ```

---

## API Endpoints

### 1. Create Game
Creates a new game room.

*   **Endpoint**: `/create-game`
*   **Method**: `POST`
*   **Body**: `{}` (Empty)
*   **Response**:
    ```json
    {
      "gameId": "uuid-string",
      "roomCode": "ABCD"
    }
    ```

### 2. Join Game
Joins an existing game using a room code.

*   **Endpoint**: `/join-game`
*   **Method**: `POST`
*   **Body**:
    ```json
    {
      "roomCode": "ABCD"
    }
    ```
*   **Response**:
    ```json
    {
      "gameId": "uuid-string"
    }
    ```

### 3. Start Game
Starts the game (Host only). Deals cards and initializes the game loop.

*   **Endpoint**: `/start-game`
*   **Method**: `POST`
*   **Body**:
    ```json
    {
      "gameId": "uuid-string"
    }
    ```
*   **Response**:
    ```json
    {
      "success": true,
      "state": { ... } // Initial Game State
    }
    ```

### 4. Get Game State
Retrieves the current game state, sanitized for the requesting user.

*   **Endpoint**: `/get-game-state`
*   **Method**: `POST` (or `GET` with `?gameId=...`)
*   **Body**:
    ```json
    {
      "gameId": "uuid-string"
    }
    ```
*   **Response**:
    ```json
    {
      "game_state": {
        "phase": "playing",
        "currentTurnUserId": "uuid...",
        "turnPhase": "draw",
        "players": {
           "uuid...": {
             "cards": [ ... ], // Face-down cards are masked
             "score": 0
           }
        },
        "drawnCard": null,
        "discardPile": [ ... ]
      }
    }
    ```

### 5. Play Move
Executes a game action.

*   **Endpoint**: `/play-move`
*   **Method**: `POST`
*   **Body**:
    ```json
    {
      "gameId": "uuid-string",
      "action": {
        "type": "ACTION_TYPE",
        ...params
      }
    }
    ```

#### Action Types & Payloads

| Action Type | Description | Additional Params |
| :--- | :--- | :--- |
| `DRAW_FROM_DECK` | Draw a card from the deck | None |
| `DRAW_FROM_DISCARD` | Draw from discard pile | None |
| `DISCARD_DRAWN` | Discard the currently drawn card | None |
| `SWAP_WITH_OWN` | Swap drawn card with one in hand | `cardIndex` (0-3) |
| `CALL_KABOO` | Call Kaboo (end game trigger) | None |
| `SNAP` | Snap a matching card out of turn | `cardIndex` (0-3) |
| `PEEK_OWN` | Effect: Look at own card | `cardIndex` |
| `SPY_OPPONENT` | Effect: Look at opponent's card | `targetPlayerId`, `cardIndex` |
| `SWAP_ANY` | Effect: Swap cards (Blind or Known) | `targetPlayerId`, `cardIndex`, `ownCardIndex` |

**Example Body:**
```json
{
  "gameId": "...",
  "action": {
    "type": "SWAP_WITH_OWN",
    "cardIndex": 1
  }
}
```

---

## Game Rules & Logic

The core logic resides in `supabase/functions/_shared/game-rules.ts`.

*   **Deck**: Standard 52 + 2 Jokers (-1 value).
*   **Values**:
    *   Red King (Hearts/Diamonds): 0
    *   Black King (Spades/Clubs): 13
    *   Joker: -1
    *   Ace: 1, 2-10: Face value
    *   J: 11, Q: 12
*   **Powers**:
    *   7/8: Peek Own
    *   9/10: Spy Opponent
    *   J/Q (Black): Blind Swap
    *   K (Black): Look & Swap
