// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInPlayer,
} from "../testUtils.ts";

Deno.test({
  name: "Toggle Ready - updates game_state and bumps games.updated_at",
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

      const { data: beforeSecret } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();
      assertExists(beforeSecret);
      const beforeState = beforeSecret.game_state;
      const beforeReady = beforeState.players?.[host.userId]?.isReady ?? false;

      const { data: beforeGameRow } = await supabaseAdmin
        .from("games")
        .select("updated_at")
        .eq("id", gameId)
        .single();
      assertExists(beforeGameRow);
      const beforeUpdatedAt = beforeGameRow.updated_at;

      const toggleReq = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, isReady: !beforeReady }),
      });
      const toggleRes = await (await import("../../toggle-ready/index.ts")).handler(toggleReq);
      assertEquals(toggleRes.status, 200);

      const { data: afterSecret } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();
      assertExists(afterSecret);
      const afterState = afterSecret.game_state;
      const afterReady = afterState.players?.[host.userId]?.isReady ?? false;
      assertEquals(afterReady, !beforeReady);

      const { data: afterGameRow } = await supabaseAdmin
        .from("games")
        .select("updated_at")
        .eq("id", gameId)
        .single();
      assertExists(afterGameRow);
      const afterUpdatedAt = afterGameRow.updated_at;
      assertEquals(typeof beforeUpdatedAt, "string");
      assertEquals(typeof afterUpdatedAt, "string");
      assertEquals(beforeUpdatedAt === afterUpdatedAt, false);
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

