// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { handler as joinGameHandler } from "../../join-game/index.ts";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  hasServiceRoleKey,
  hasSupabaseEnv,
  signInTestUser,
} from "../testUtils.ts";

Deno.test({
  name: "Join Lobby - Already joined returns message and no duplicate row",
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
      const firstJoinReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomCode, playerName: guestName }),
      });
      const firstJoinRes = await joinGameHandler(firstJoinReq);
      assertEquals(firstJoinRes.status, 200);
      const firstJoinBody = await firstJoinRes.json();
      assertEquals(firstJoinBody.gameId, gameId);

      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );

      const { data: playersBefore } = await supabaseAdmin
        .from("game_players")
        .select("id")
        .eq("game_id", gameId);
      const countBefore = playersBefore?.length ?? 0;

      const secondJoinReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${guestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomCode, playerName: guestName }),
      });
      const secondJoinRes = await joinGameHandler(secondJoinReq);
      assertEquals(secondJoinRes.status, 200);
      const secondJoinBody = await secondJoinRes.json();
      assertEquals(secondJoinBody.message, "Already joined");
      assertEquals(secondJoinBody.gameId, gameId);

      const { data: playersAfter } = await supabaseAdmin
        .from("game_players")
        .select("id")
        .eq("game_id", gameId);
      const countAfter = playersAfter?.length ?? 0;
      assertEquals(countAfter, countBefore);
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
  name: "Join Lobby - Case-insensitive roomCode and max players enforced",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const hostToken = hostAuth.token;

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

      const supabaseAdmin = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY!,
      );
      const { data: secretData } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();

      const maxPlayers = secretData?.game_state?.settings?.numPlayers ?? 4;

      const lowercaseRoomCode = roomCode.toLowerCase();

      const guests: { token: string }[] = [];
      for (let i = 0; i < maxPlayers; i++) {
        const guestAuth = await signInTestUser();
        guests.push({ token: guestAuth.token });
      }

      const firstGuest = guests[0];
      const firstJoinReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${firstGuest.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomCode: lowercaseRoomCode,
          playerName: "Guest_Case",
        }),
      });
      const firstJoinRes = await joinGameHandler(firstJoinReq);
      assertEquals(firstJoinRes.status, 200);
      const firstJoinBody = await firstJoinRes.json();
      assertEquals(firstJoinBody.gameId, gameId);

      for (let i = 1; i < maxPlayers - 1; i++) {
        const guest = guests[i];
        const joinReq = new Request("http://localhost/join-game", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${guest.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roomCode, playerName: `Guest_${i}` }),
        });
        const joinRes = await joinGameHandler(joinReq);
        assertEquals(joinRes.status, 200);
      }

      const overfillGuest = guests[maxPlayers - 1];
      const overfillReq = new Request("http://localhost/join-game", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${overfillGuest.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomCode, playerName: "TooMany" }),
      });
      const overfillRes = await joinGameHandler(overfillReq);
      assertEquals(overfillRes.status, 400);
      const overfillBody = await overfillRes.json();
      assertEquals(overfillBody.error, "Game is full");
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
  name: "Join Lobby - concurrent joins respect max players",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const hostAuth = await signInTestUser();
    const hostToken = hostAuth.token;

    let gameId = "";
    let roomCode = "";

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY!,
    );

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

      const { data: secretData } = await supabaseAdmin
        .from("game_secrets")
        .select("game_state")
        .eq("game_id", gameId)
        .single();
      assertExists(secretData);

      const gameState = secretData.game_state;
      gameState.settings = {
        ...gameState.settings,
        numPlayers: 2,
      };

      const { error: updateSecretsError } = await supabaseAdmin
        .from("game_secrets")
        .update({ game_state: gameState })
        .eq("game_id", gameId);
      if (updateSecretsError) throw updateSecretsError;

      const guests: { token: string; name: string }[] = [];
      for (let i = 0; i < 3; i++) {
        const guestAuth = await signInTestUser();
        guests.push({
          token: guestAuth.token,
          name: `Guest_${i}`,
        });
      }

      const joinResults = await Promise.all(
        guests.map(async (g) => {
          const joinReq = new Request("http://localhost/join-game", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${g.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ roomCode, playerName: g.name }),
          });
          const res = await joinGameHandler(joinReq);
          const body = await res.json();
          return { status: res.status, body };
        }),
      );

      const successes = joinResults.filter((r) => r.status === 200);
      const failures = joinResults.filter((r) => r.status === 400);

      assertEquals(successes.length, 1);
      assertEquals(failures.length, 2);

      for (const f of failures) {
        const msg = String(f.body.error ?? "");
        if (
          !msg.includes("Game is full") &&
          !msg.toLowerCase().includes("duplicate key value") &&
          !msg.toLowerCase().includes("unique constraint")
        ) {
          throw new Error(`Unexpected concurrent join error: ${msg}`);
        }
      }

      const { data: players } = await supabaseAdmin
        .from("game_players")
        .select("id")
        .eq("game_id", gameId);
      const count = players?.length ?? 0;
      assertEquals(count, 2);
    } finally {
      if (gameId) {
        await supabaseAdmin.from("games").delete().eq("id", gameId);
      }
    }
  },
});

