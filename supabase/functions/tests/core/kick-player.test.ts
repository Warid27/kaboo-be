// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import { handler as playMoveHandler } from "../../play-move/index.ts";
import { handler as getGameStateHandler } from "../../get-game-state/index.ts";
import { handler as kickPlayerHandler } from "../../kick-player/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInPlayer,
} from "../testUtils.ts";

Deno.test({
  name: "Kick Player - host can kick and kicked user cannot act",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const host = await signInPlayer();
    const guest = await signInPlayer();
    const hostToken = host.token;
    const guestToken = guest.token;

    let gameId = "";
    let roomCode = "";

    try {
      const hostName = `Host_${Math.random().toString(36).substring(7)}`;
      const createReq = new Request("http://localhost/create-game", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playerName: hostName }),
      });
      const createRes = await createGameHandler(createReq);
      assertEquals(createRes.status, 200);
      const createBody = await createRes.json();
      gameId = createBody.gameId;
      roomCode = createBody.roomCode;

      const guestName = `Guest_${Math.random().toString(36).substring(7)}`;
      const joinReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomCode, playerName: guestName }),
      });
      const joinRes = await joinGameHandler(joinReq);
      assertEquals(joinRes.status, 200);

      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      const { data: playerRow } = await supabaseAdmin
        .from("game_players")
        .select("user_id")
        .eq("game_id", gameId)
        .eq("user_id", guest.userId)
        .single();
      assertExists(playerRow);

      const kickReq = new Request("http://localhost/kick-player", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, playerId: guest.userId }),
      });
      const kickRes = await kickPlayerHandler(kickReq);
      assertEquals(kickRes.status, 200);
      const kickBody = await kickRes.json();
      assertEquals(kickBody.success, true);
      assertEquals(kickBody.kickedPlayerId, guest.userId);

      const { data: afterKick } = await supabaseAdmin
        .from("game_players")
        .select("user_id")
        .eq("game_id", gameId)
        .eq("user_id", guest.userId)
        .maybeSingle();
      assertEquals(afterKick, null);

      const getStateReq = new Request(
        `http://localhost/get-game-state?gameId=${gameId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${guestToken}`,
          },
        },
      );
      const getStateRes = await getGameStateHandler(getStateReq);
      assertEquals(getStateRes.status, 400);
      const getStateBody = await getStateRes.json();
      assertEquals(getStateBody.error, "You are not in this game");

      const playReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const playRes = await playMoveHandler(playReq);
      assertEquals(playRes.status, 400);
    } finally {
      if (gameId) {
        const supabaseAdmin = createClient(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY!,
        );
        await supabaseAdmin.from("games").delete().eq("id", gameId);
      }
    }
  },
});

Deno.test({
  name: "Kick Player - non-host cannot kick",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const host = await signInPlayer();
    const guest = await signInPlayer();
    const hostToken = host.token;
    const guestToken = guest.token;

    let gameId = "";
    let roomCode = "";

    try {
      const hostName = `Host_${Math.random().toString(36).substring(7)}`;
      const createReq = new Request("http://localhost/create-game", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playerName: hostName }),
      });
      const createRes = await createGameHandler(createReq);
      assertEquals(createRes.status, 200);
      const createBody = await createRes.json();
      gameId = createBody.gameId;
      roomCode = createBody.roomCode;

      const guestName = `Guest_${Math.random().toString(36).substring(7)}`;
      const joinReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomCode, playerName: guestName }),
      });
      const joinRes = await joinGameHandler(joinReq);
      assertEquals(joinRes.status, 200);

      const kickReq = new Request("http://localhost/kick-player", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, playerId: host.userId }),
      });
      const kickRes = await kickPlayerHandler(kickReq);
      assertEquals(kickRes.status, 400);
      const kickBody = await kickRes.json();
      assertEquals(kickBody.error, "Only the host can kick players");
    } finally {
      if (gameId) {
        const supabaseAdmin = createClient(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY!,
        );
        await supabaseAdmin.from("games").delete().eq("id", gameId);
      }
    }
  },
});

