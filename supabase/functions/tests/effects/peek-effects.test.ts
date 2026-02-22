// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import { handler as startGameHandler } from "../../start-game/index.ts";
import { handler as playMoveHandler } from "../../play-move/index.ts";
import { handler as getGameStateHandler } from "../../get-game-state/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  TEST_USER_EMAILS,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInPlayer,
  supabase,
} from "../testUtils.ts";

async function signInAnonymousExtra() {
  const key = "anon-extra";
  const sessionCache = new Map<string, { token: string; userId: string }>();
  const cached = sessionCache.get(key);
  if (cached) {
    return cached;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session || !data.user) throw error || new Error("Auth failed");
  const session = { token: data.session.access_token, userId: data.user.id };
  sessionCache.set(key, session);
  return session;
}

async function createAndStartThreePlayerGame() {
  const host = await signInPlayer();
  const guest1 = await signInPlayer();
  const guest2 = TEST_USER_EMAILS.length >= 3
    ? await signInPlayer()
    : await signInAnonymousExtra();

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
  const gameId = createBody.gameId as string;
  const roomCode = createBody.roomCode as string;

  const joinReq1 = new Request("http://localhost/join-game", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${guest1.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomCode, playerName: `G1_${Math.random().toString(36).slice(2)}` }),
  });
  const joinRes1 = await joinGameHandler(joinReq1);
  assertEquals(joinRes1.status, 200);

  const joinReq2 = new Request("http://localhost/join-game", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${guest2.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomCode, playerName: `G2_${Math.random().toString(36).slice(2)}` }),
  });
  const joinRes2 = await joinGameHandler(joinReq2);
  assertEquals(joinRes2.status, 200);

  const readyReqHost = new Request("http://localhost/toggle-ready", {
    method: "POST",
    headers: { Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, isReady: true }),
  });
  const readyResHost = await (await import("../../toggle-ready/index.ts")).handler(readyReqHost);
  assertEquals(readyResHost.status, 200);

  const readyReqG1 = new Request("http://localhost/toggle-ready", {
    method: "POST",
    headers: { Authorization: `Bearer ${guest1.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, isReady: true }),
  });
  const readyResG1 = await (await import("../../toggle-ready/index.ts")).handler(readyReqG1);
  assertEquals(readyResG1.status, 200);

  const readyReqG2 = new Request("http://localhost/toggle-ready", {
    method: "POST",
    headers: { Authorization: `Bearer ${guest2.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, isReady: true }),
  });
  const readyResG2 = await (await import("../../toggle-ready/index.ts")).handler(readyReqG2);
  assertEquals(readyResG2.status, 200);

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

  return { gameId, host, guest1, guest2 };
}

Deno.test({
  name: "Effects E2E - 7 Peek resolves and game keeps playing",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const { gameId, host, guest1, guest2 } = await createAndStartThreePlayerGame();

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY!,
    );

    try {
      const getStateReq = new Request(`http://localhost/get-game-state?gameId=${gameId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${host.token}` },
      });
      const getStateRes = await getGameStateHandler(getStateReq);
      assertEquals(getStateRes.status, 200);
      const getStateBody = await getStateRes.json();
      let gameState = getStateBody.game_state;
      assertEquals(gameState.phase, "initial_look");

      const readyHostReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const readyHostRes = await playMoveHandler(readyHostReq);
      assertEquals(readyHostRes.status, 200);

      const readyG1Req = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guest1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const readyG1Res = await playMoveHandler(readyG1Req);
      assertEquals(readyG1Res.status, 200);

      const readyG2Req = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guest2.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const readyG2Res = await playMoveHandler(readyG2Req);
      assertEquals(readyG2Res.status, 200);
      const readyG2Body = await readyG2Res.json();
      gameState = readyG2Body.game_state;
      assertEquals(gameState.phase, "playing");

      const currentTurnUserId = gameState.currentTurnUserId as string;
      const turnPlayer =
        currentTurnUserId === host.userId
          ? host
          : currentTurnUserId === guest1.userId
          ? guest1
          : guest2;

      const setDeckReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId,
          action: {
            type: "SET_TEST_DECK",
            cards: [{ rank: "7", suit: "hearts" }],
          },
        }),
      });
      const setDeckRes = await playMoveHandler(setDeckReq);
      assertEquals(setDeckRes.status, 200);

      const peekMoveReq1 = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "DRAW_FROM_DECK" } }),
      });
      const peekMoveRes1 = await playMoveHandler(peekMoveReq1);
      assertEquals(peekMoveRes1.status, 200);

      const peekMoveReq2 = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "DISCARD_DRAWN" } }),
      });
      const peekMoveRes2 = await playMoveHandler(peekMoveReq2);
      assertEquals(peekMoveRes2.status, 200);
      const peekMoveBody2 = await peekMoveRes2.json();
      gameState = peekMoveBody2.game_state;

      if (gameState.turnPhase === "effect" && gameState.pendingEffect?.type === "PEEK_OWN") {
        const resolveEffectReq = new Request("http://localhost/play-move", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${turnPlayer.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ gameId, action: { type: "PEEK_OWN", cardIndex: 0 } }),
        });
        const resolveEffectRes = await playMoveHandler(resolveEffectReq);
        assertEquals(resolveEffectRes.status, 200);
        const resolvedBody = await resolveEffectRes.json();
        gameState = resolvedBody.game_state;
      }

      assertEquals(gameState.phase, "playing");
    } finally {
      await supabaseAdmin.from("games").delete().eq("id", gameId);
    }
  },
});

Deno.test({
  name: "Effects E2E - 9 PeekOther resolves correctly",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const { gameId, host, guest1, guest2 } = await createAndStartThreePlayerGame();

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY!,
    );

    try {
      const getStateReq = new Request(`http://localhost/get-game-state?gameId=${gameId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${host.token}` },
      });
      const getStateRes = await getGameStateHandler(getStateReq);
      assertEquals(getStateRes.status, 200);
      const getStateBody = await getStateRes.json();
      let gameState = getStateBody.game_state;
      assertEquals(gameState.phase, "initial_look");

      const readyHostReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const readyHostRes = await playMoveHandler(readyHostReq);
      assertEquals(readyHostRes.status, 200);

      const readyG1Req = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guest1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const readyG1Res = await playMoveHandler(readyG1Req);
      assertEquals(readyG1Res.status, 200);

      const readyG2Req = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guest2.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "READY_TO_PLAY" } }),
      });
      const readyG2Res = await playMoveHandler(readyG2Req);
      assertEquals(readyG2Res.status, 200);
      const readyG2Body = await readyG2Res.json();
      gameState = readyG2Body.game_state;
      assertEquals(gameState.phase, "playing");

      const currentTurnUserId = gameState.currentTurnUserId as string;
      const turnPlayer =
        currentTurnUserId === host.userId
          ? host
          : currentTurnUserId === guest1.userId
          ? guest1
          : guest2;

      const setDeckReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId,
          action: {
            type: "SET_TEST_DECK",
            cards: [{ rank: "9", suit: "hearts" }],
          },
        }),
      });
      const setDeckRes = await playMoveHandler(setDeckReq);
      assertEquals(setDeckRes.status, 200);

      const drawReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "DRAW_FROM_DECK" } }),
      });
      const drawRes = await playMoveHandler(drawReq);
      assertEquals(drawRes.status, 200);

      const discardReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, action: { type: "DISCARD_DRAWN" } }),
      });
      const discardRes = await playMoveHandler(discardReq);
      assertEquals(discardRes.status, 200);
      const discardBody = await discardRes.json();
      gameState = discardBody.game_state;

      assertEquals(gameState.turnPhase, "effect");
      assertEquals(gameState.pendingEffect?.type, "PEEK_OTHER");

      const targetPlayerId =
        turnPlayer.userId === host.userId
          ? guest1.userId
          : host.userId;

      const resolveEffectReq = new Request("http://localhost/play-move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnPlayer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId,
          action: {
            type: "SPY_OPPONENT",
            targetPlayerId,
            cardIndex: 0,
          },
        }),
      });
      const resolveEffectRes = await playMoveHandler(resolveEffectReq);
      assertEquals(resolveEffectRes.status, 200);

      const resolvedBody = await resolveEffectRes.json();
      gameState = resolvedBody.game_state;
      assertEquals(gameState.turnPhase, "draw");
      assertEquals(gameState.pendingEffect, null);
    } finally {
      await supabaseAdmin.from("games").delete().eq("id", gameId);
    }
  },
});

