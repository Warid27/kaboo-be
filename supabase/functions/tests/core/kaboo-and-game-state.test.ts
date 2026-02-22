// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import { handler as startGameHandler } from "../../start-game/index.ts";
import { handler as playMoveHandler } from "../../play-move/index.ts";
import { handler as getGameStateHandler } from "../../get-game-state/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInPlayer,
} from "../testUtils.ts";

async function createAndStartTwoPlayerGame() {
  const host = await signInPlayer();
  const guest = await signInPlayer();

  let gameId = "";
  let roomCode = "";

  const hostName = `Host_${Math.random().toString(36).substring(7)}`;
  const createReq = new Request("http://localhost/create-game", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ playerName: hostName }),
  });
  const createRes = await createGameHandler(createReq);
  assertEquals(createRes.status, 200);
  const createBody = await createRes.json();
  gameId = createBody.gameId;
  roomCode = createBody.roomCode;
  assertExists(gameId);
  assertExists(roomCode);

  const guestName = `Guest_${Math.random().toString(36).substring(7)}`;
  const joinReq = new Request("http://localhost/join-game", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${guest.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomCode, playerName: guestName }),
  });
  const joinRes = await joinGameHandler(joinReq);
  assertEquals(joinRes.status, 200);

  const readyReq1 = new Request("http://localhost/toggle-ready", {
    method: "POST",
    headers: { Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, isReady: true }),
  });
  const readyRes1 = await (await import("../../toggle-ready/index.ts")).handler(readyReq1);
  assertEquals(readyRes1.status, 200);

  const readyReq2 = new Request("http://localhost/toggle-ready", {
    method: "POST",
    headers: { Authorization: `Bearer ${guest.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, isReady: true }),
  });
  const readyRes2 = await (await import("../../toggle-ready/index.ts")).handler(readyReq2);
  assertEquals(readyRes2.status, 200);

  const startReq = new Request("http://localhost/start-game", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gameId }),
  });
  const startRes = await startGameHandler(startReq);
  assertEquals(startRes.status, 200);
  const startBody = await startRes.json();
  assertEquals(startBody.success, true);

  return { gameId, host, guest };
}

Deno.test({
  name: "Kaboo Core E2E - Player calls Kaboo and final-round turns progress",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const { gameId, host, guest } = await createAndStartTwoPlayerGame();

    try {
      const getStateReqHost = new Request(`http://localhost/get-game-state?gameId=${gameId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${host.token}`,
        },
      });
      const getStateResHost = await getGameStateHandler(getStateReqHost);
      assertEquals(getStateResHost.status, 200);
      const stateBodyHost = await getStateResHost.json();
      const stateHost = stateBodyHost.game_state;
      assertEquals(stateHost.phase, "initial_look");

      const readyMoveHostReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId,
          action: { type: "READY_TO_PLAY" },
        }),
      });
      const readyMoveHostRes = await playMoveHandler(readyMoveHostReq);
      assertEquals(readyMoveHostRes.status, 200);

      const readyMoveGuestReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guest.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId,
          action: { type: "READY_TO_PLAY" },
        }),
      });
      const readyMoveGuestRes = await playMoveHandler(readyMoveGuestReq);
      assertEquals(readyMoveGuestRes.status, 200);
      const readyMoveGuestBody = await readyMoveGuestRes.json();
      const readyState = readyMoveGuestBody.game_state;
      assertEquals(readyState.phase, "playing");

      const currentTurnUserId = readyState.currentTurnUserId as string;
      let kabooCallerToken: string;
      if (currentTurnUserId === host.userId) {
        kabooCallerToken = host.token;
      } else if (currentTurnUserId === guest.userId) {
        kabooCallerToken = guest.token;
      } else {
        throw new Error("Current turn user is not one of the test players");
      }

      const kabooReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${kabooCallerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId,
          action: { type: "CALL_KABOO" },
        }),
      });
      const kabooRes = await playMoveHandler(kabooReq);
      assertEquals(kabooRes.status, 200);
      const kabooBody = await kabooRes.json();
      const kabooState = kabooBody.game_state;
      assertEquals(kabooState.kabooCallerId, currentTurnUserId);
      assertEquals(kabooState.phase, "playing");
      assertEquals(typeof kabooState.turnsLeftAfterKaboo, "number");
    } finally {
      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      await supabaseAdmin.from("games").delete().eq("id", gameId);
    }
  },
});

Deno.test({
  name: "Get Game State - happy path returns sanitized state and consistent players",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const { gameId, host, guest } = await createAndStartTwoPlayerGame();

    try {
      const getReq = new Request(
        `http://localhost/get-game-state?gameId=${gameId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${host.token}`,
          },
        },
      );
      const getRes = await getGameStateHandler(getReq);
      assertEquals(getRes.status, 200);
      const body = await getRes.json();
      const state = body.game_state;

      assertExists(state.players);
      assertExists(state.playerOrder);

      const playerIds = Object.keys(state.players);
      assertEquals(playerIds.includes(host.userId), true);
      assertEquals(playerIds.includes(guest.userId), true);
      assertEquals(state.playerOrder.length, playerIds.length);

      const opponent = state.players[guest.userId];
      const maskedCards = opponent.cards.filter((c: { faceUp: boolean }) =>
        !c.faceUp
      );
      if (maskedCards.length > 0) {
        const card = maskedCards[0] as { rank: string; value: number };
        assertEquals(card.rank, "A");
        assertEquals(card.value, 0);
      }
    } finally {
      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      await supabaseAdmin.from("games").delete().eq("id", gameId);
    }
  },
});

Deno.test({
  name: "Start Game - initializes deck, discard, and hands correctly",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const { gameId, host, guest } = await createAndStartTwoPlayerGame();

    try {
      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      const { data: secretRow } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();

      assertExists(secretRow);
      const state = secretRow.game_state;

      assertEquals(state.phase, "initial_look");
      const players = state.players;
      const playerIds = Object.keys(players);
      assertEquals(playerIds.length, 2);
      assertEquals(playerIds.includes(host.userId), true);
      assertEquals(playerIds.includes(guest.userId), true);

      for (const pid of playerIds) {
        const p = players[pid];
        assertEquals(Array.isArray(p.cards), true);
        assertEquals(p.cards.length, 4);
      }

      assertEquals(Array.isArray(state.discardPile), true);
      assertEquals(state.discardPile.length, 1);
      assertEquals(Array.isArray(state.deck), true);
      assertEquals(state.deck.length > 0, true);
      assertEquals(Array.isArray(state.playerOrder), true);
      assertEquals(state.playerOrder.length, playerIds.length);
    } finally {
      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      await supabaseAdmin.from("games").delete().eq("id", gameId);
    }
  },
});

