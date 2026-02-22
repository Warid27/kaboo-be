// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
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
  name: "Start Game - rejected when fewer than two players",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const hostToken = hostAuth.token;

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

      const startReq = new Request("http://localhost/start-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const startRes = await startGameHandler(startReq);
      assertEquals(startRes.status, 400);
      const startBody = await startRes.json();
      assertEquals(startBody.error, "Need at least 2 players");
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
  name: "Start Game - second start attempt is rejected once playing",
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

      const startReq1 = new Request("http://localhost/start-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const startRes1 = await startGameHandler(startReq1);
      assertEquals(startRes1.status, 200);

      const startReq2 = new Request("http://localhost/start-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      const startRes2 = await startGameHandler(startReq2);
      assertEquals(startRes2.status, 400);
      const startBody2 = await startRes2.json();
      assertEquals(startBody2.error, "Game already started");
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

