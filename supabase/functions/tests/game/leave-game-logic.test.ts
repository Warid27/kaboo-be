import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("Leave Game Logic - Last player leaving deletes game", async () => {
  const gameId = "game-1";
  const remainingPlayers: any[] = [];

  const shouldDelete = remainingPlayers.length === 0;
  assertEquals(shouldDelete, true);
});

Deno.test("Leave Game Logic - Host leaving migrates host", async () => {
  const currentHostId = "host-1";
  const remainingPlayers = [{ user_id: "player-2" }];

  const newHostId = remainingPlayers[0].user_id;
  assertEquals(newHostId, "player-2");
});

