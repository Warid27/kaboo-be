// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInTestUser,
} from "../testUtils.ts";

Deno.test({
  name: "Create Game - persists game, secrets, and host player with invariants",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const hostToken = hostAuth.token;
    const hostId = hostAuth.userId;

    let gameId = "";

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
      const roomCode = createBody.roomCode as string;

      assertExists(gameId);
      assertExists(roomCode);
      assertEquals(typeof gameId, "string");
      assertEquals(typeof roomCode, "string");
      assertEquals(roomCode.length, 4);
      assertEquals(roomCode, roomCode.toUpperCase());

      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );

      const supabaseHost = createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: `Bearer ${hostToken}` } } },
      );

      const { data: gameRow } = await supabaseAdmin
        .from("games")
        .select("id, created_by, status, room_code")
        .eq("id", gameId)
        .single();
      assertExists(gameRow);
      assertEquals(gameRow.id, gameId);
      assertEquals(gameRow.created_by, hostId);
      assertEquals(gameRow.status, "waiting");
      assertEquals(gameRow.room_code, roomCode);

      const { data: secretRow } = await supabaseAdmin
        .from("game_secrets")
        .select("game_id, game_state")
        .eq("game_id", gameId)
        .single();
      assertExists(secretRow);
      assertEquals(secretRow.game_id, gameId);
      const state = secretRow.game_state;
      assertEquals(state.phase, "lobby");
      assertEquals(typeof state.settings, "object");
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
  name: "Create Game - same user can create multiple games with different ids and codes",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const hostToken = hostAuth.token;

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY!,
    );

    const created: { gameId: string; roomCode: string }[] = [];

    try {
      for (let i = 0; i < 2; i++) {
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
        created.push({ gameId: createBody.gameId, roomCode: createBody.roomCode });
      }

      assertEquals(created.length, 2);
      assertEquals(created[0].gameId === created[1].gameId, false);
      assertEquals(created[0].roomCode === created[1].roomCode, false);

      for (const g of created) {
        const { data: gameRow } = await supabaseAdmin
          .from("games")
          .select("id")
          .eq("id", g.gameId)
          .maybeSingle();
        assertExists(gameRow);
      }
    } finally {
      if (created.length > 0) {
        const ids = created.map((g) => g.gameId);
        await supabaseAdmin.from("games").delete().in("id", ids);
      }
    }
  },
});

