// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import { handler as startGameHandler } from "../../start-game/index.ts";
import { handler as toggleReadyHandler } from "../../toggle-ready/index.ts";
import { handler as endGameHandler } from "../../end-game/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInTestUser,
} from "../testUtils.ts";

Deno.test({
  name: "Lobby - non-existent roomCode and non-host start/end are rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const guestAuth = await signInTestUser();
    const hostToken = hostAuth.token;
    const guestToken = guestAuth.token;

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

      const badJoinReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomCode: "INVALID_CODE",
          playerName: "Guest_Invalid",
        }),
      });
      const badJoinRes = await joinGameHandler(badJoinReq);
      assertEquals(badJoinRes.status, 400);
      const badJoinBody = await badJoinRes.json();
      assertEquals(badJoinBody.error, "Game not found");

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

      const readyReqHost = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, isReady: true }),
      });
      const readyResHost = await toggleReadyHandler(readyReqHost);
      assertEquals(readyResHost.status, 200);

      const nonHostStartReq = new Request("http://localhost/start-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const nonHostStartRes = await startGameHandler(nonHostStartReq);
      assertEquals(nonHostStartRes.status, 400);
      const nonHostStartBody = await nonHostStartRes.json();
      const nonHostStartError = nonHostStartBody.error as string;
      if (!nonHostStartError.includes("Only host can start game")) {
        throw new Error("Unexpected non-host start-game error message");
      }

      const readyReqGuest = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, isReady: true }),
      });
      const readyResGuest = await toggleReadyHandler(readyReqGuest);
      assertEquals(readyResGuest.status, 200);

      const nonHostEndReq = new Request("http://localhost/end-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const nonHostEndRes = await endGameHandler(nonHostEndReq);
      assertEquals(nonHostEndRes.status, 400);
      const nonHostEndBody = await nonHostEndRes.json();
      const nonHostEndError = nonHostEndBody.error as string;
      if (!nonHostEndError.includes("Only the host can end the game")) {
        throw new Error("Unexpected non-host end-game error message");
      }
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

