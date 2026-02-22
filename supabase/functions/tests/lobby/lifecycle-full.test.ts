// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import { handler as leaveGameHandler } from "../../leave-game/index.ts";
import { handler as endGameHandler } from "../../end-game/index.ts";
import { handler as startGameHandler } from "../../start-game/index.ts";
import { handler as toggleReadyHandler } from "../../toggle-ready/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInTestUser,
} from "../testUtils.ts";

Deno.test({
  name: "Backend E2E - Full Lifecycle (Create -> Join -> Leave -> End)",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const guestAuth = await signInTestUser();
    const hostToken = hostAuth.token;
    const hostId = hostAuth.userId;
    const guestToken = guestAuth.token;

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY!,
    );

    let gameId = "";
    let roomCode = "";

    try {
      const hostName = `Host_${Math.random().toString(36).substring(7)}`;
      const createReq = new Request("http://localhost/create-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
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
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomCode, playerName: guestName }),
      });
      const joinRes = await joinGameHandler(joinReq);
      assertEquals(joinRes.status, 200);
      const joinBody = await joinRes.json();
      assertEquals(joinBody.gameId, gameId);

      const { data: playersBefore } = await supabaseAdmin
        .from("game_players")
        .select("user_id")
        .eq("game_id", gameId);
      assertEquals(playersBefore?.length, 2);

      const readyReq1 = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, isReady: true }),
      });
      const readyRes1 = await toggleReadyHandler(readyReq1);
      assertEquals(readyRes1.status, 200);

      const readyReq2 = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, isReady: true }),
      });
      const readyRes2 = await toggleReadyHandler(readyReq2);
      assertEquals(readyRes2.status, 200);

      const startReq = new Request("http://localhost/start-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const startRes = await startGameHandler(startReq);
      assertEquals(startRes.status, 200);
      const startBody = await startRes.json();
      assertEquals(startBody.success, true);

      const leaveReq = new Request("http://localhost/leave-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const leaveRes = await leaveGameHandler(leaveReq);
      assertEquals(leaveRes.status, 200);
      const leaveBody = await leaveRes.json();
      assertEquals(leaveBody.success, true);

      const { data: playersAfterLeave } = await supabaseAdmin
        .from("game_players")
        .select("user_id")
        .eq("game_id", gameId);
      assertEquals(playersAfterLeave?.length, 1);
      assertEquals(playersAfterLeave?.[0].user_id, hostId);

      const endReq = new Request("http://localhost/end-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const endRes = await endGameHandler(endReq);
      assertEquals(endRes.status, 200);
      const endBody = await endRes.json();
      assertEquals(endBody.success, true);

      const { data: gameAfterEnd } = await supabaseAdmin
        .from("games")
        .select("id")
        .eq("id", gameId)
        .maybeSingle();
      assertEquals(gameAfterEnd, null);
    } finally {
      if (gameId) {
        await supabaseAdmin.from("games").delete().eq("id", gameId);
      }
    }
  },
});
