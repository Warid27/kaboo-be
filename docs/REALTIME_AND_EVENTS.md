# Kaboo Realtime & Integration Guide

## Overview

The Kaboo backend uses a "Signal-then-Fetch" pattern to ensure secure and efficient real-time updates. This approach separates the notification of state changes from the retrieval of sensitive game data.

## 1. Realtime Architecture

### Channels & Events

The frontend should subscribe to the following Supabase Realtime channels:

#### A. Lobby Updates (`game_players` table)
Used to show players joining the lobby in real-time.

- **Channel**: `public:game_players`
- **Filter**: `game_id=eq.{gameId}`
- **Events**:
  - `INSERT`: A new player joined.
  - `UPDATE`: A player's connection status or score changed.
  - `DELETE`: A player left (if implemented).

**Example Code:**
```javascript
const channel = supabase
  .channel('lobby')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'game_players',
      filter: `game_id=eq.${gameId}`,
    },
    (payload) => {
      console.log('Lobby update:', payload);
      // Refresh player list
    }
  )
  .subscribe();
```

#### B. Game State Updates (`games` table)
Used to signal that the game state has changed (e.g., a move was played).

- **Channel**: `public:games`
- **Filter**: `id=eq.{gameId}`
- **Events**:
  - `UPDATE`: The `updated_at` field changed (or status changed).

**Example Code:**
```javascript
const channel = supabase
  .channel('game_state')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'games',
      filter: `id=eq.${gameId}`,
    },
    (payload) => {
      console.log('Game updated:', payload);
      // FETCH the new state immediately
      fetchGameState(gameId);
    }
  )
  .subscribe();
```

## 2. Signal-then-Fetch Pattern

The `games` table does NOT contain the full `game_state`. The full state is stored in `game_secrets` (accessible only via Edge Functions) to prevent data leaks (e.g., seeing opponent cards).

**Flow:**
1.  **Action**: Player A calls `play-move`.
2.  **Server**: Validates move, updates `game_secrets`, and updates `games.updated_at`.
3.  **Realtime**: Supabase sends an `UPDATE` event for the `games` table to all subscribed clients.
4.  **Client**:
    *   Receives `UPDATE` event.
    *   Calls `get-game-state` Edge Function.
5.  **Edge Function**:
    *   Fetches full state from `game_secrets`.
    *   Sanitizes it (masks face-down cards).
    *   Returns the view for the specific player.

## 3. API Endpoints

### `create-game`
- **Method**: POST
- **Body**: `{}`
- **Returns**: `{ gameId: string, roomCode: string }`

### `join-game`
- **Method**: POST
- **Body**: `{ roomCode: string }`
- **Returns**: `{ gameId: string }`

### `start-game`
- **Method**: POST
- **Body**: `{ gameId: string }`
- **Returns**: `{ success: true }`

### `play-move`
- **Method**: POST
- **Body**: `{ gameId: string, action: GameAction }`
- **Returns**: `{ success: true, game_state: GameState, result: MoveResult }`

### `get-game-state`
- **Method**: POST
- **Body**: `{ gameId: string }`
- **Returns**: `{ game_state: GameState }`

## 4. Verification

To verify the integration end-to-end:

1.  **Create Game**: User A creates a game. Check `games` table.
2.  **Join Game**: User B joins with code. Check `game_players`.
3.  **Realtime**: User A should see User B appear in the lobby (via `game_players` INSERT).
4.  **Start Game**: User A starts. Check `games.status` = 'playing'.
5.  **Play Move**: User A plays a move.
    *   Check `games.updated_at` changed.
    *   Check `game_secrets.game_state` updated.
    *   User B receives Realtime event -> calls `get-game-state` -> sees updated board.
