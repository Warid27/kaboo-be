// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import { handler as updateSettingsHandler } from "../../update-settings/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInPlayer,
} from "../testUtils.ts";

Deno.test({
  name: "Update Settings - host updates settings and non-host is rejected",
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
      const { data: secretBefore } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();

      const turnTimerBefore = secretBefore?.game_state?.settings?.turnTimer;

      const updateReq = new Request("http://localhost/update-settings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, settings: { turnTimer: "45" } }),
      });
      const updateRes = await updateSettingsHandler(updateReq);
      assertEquals(updateRes.status, 200);
      const updateBody = await updateRes.json();
      assertEquals(updateBody.success, true);
      assertEquals(updateBody.settings.turnTimer, "45");

      const { data: secretAfter } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();

      const turnTimerAfter = secretAfter?.game_state?.settings?.turnTimer;
      assertEquals(turnTimerAfter, "45");
      assertEquals(turnTimerAfter === turnTimerBefore, false);

      const nonHostUpdateReq = new Request("http://localhost/update-settings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, settings: { turnTimer: "60" } }),
      });
      const nonHostUpdateRes = await updateSettingsHandler(nonHostUpdateReq);
      assertEquals(nonHostUpdateRes.status, 400);
      const nonHostUpdateBody = await nonHostUpdateRes.json();
      assertEquals(nonHostUpdateBody.error, "Only the host can update settings");
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

