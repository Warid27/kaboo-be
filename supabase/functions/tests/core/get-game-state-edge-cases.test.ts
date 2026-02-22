// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as getGameStateHandler } from "../../get-game-state/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInPlayer,
} from "../testUtils.ts";

Deno.test({
  name: "Get Game State - missing game_state returns default lobby state",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const host = await signInPlayer();
    const hostToken = host.token;

    let gameId = "";

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

      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      await supabaseAdmin
        .from("game_secrets")
        .update({ game_state: {} })
        .eq("game_id", gameId);

      const getReq = new Request(
        `http://localhost/get-game-state?gameId=${gameId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${hostToken}`,
          },
        },
      );
      const getRes = await getGameStateHandler(getReq);
      assertEquals(getRes.status, 200);
      const body = await getRes.json();
      const state = body.game_state;
      assertEquals(state.phase, "lobby");
      assertEquals(Object.keys(state.players).length, 0);
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
  name: "Get Game State - user not in game is rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const host = await signInPlayer();
    const stranger = await signInPlayer();
    const hostToken = host.token;
    const strangerToken = stranger.token;

    let gameId = "";

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

      const getReq = new Request(
        `http://localhost/get-game-state?gameId=${gameId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${strangerToken}`,
          },
        },
      );
      const getRes = await getGameStateHandler(getReq);
      assertEquals(getRes.status, 400);
      const body = await getRes.json();
      assertEquals(body.error, "You are not in this game");
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

