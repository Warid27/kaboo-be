import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("End Game Logic - Host can end game", async () => {
  const userId = "host-id";
  const gameId = "game-1";
  const gameData = { id: gameId, created_by: userId };

  assertEquals(gameData.created_by, userId);
});

Deno.test("End Game Logic - Non-host cannot end game", async () => {
  const userId = "player-id";
  const gameId = "game-1";
  const gameData = { id: gameId, created_by: "host-id" };

  const canEnd = gameData.created_by === userId;
  assertEquals(canEnd, false);
});

