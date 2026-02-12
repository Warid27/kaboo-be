// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler as createGameHandler } from "../create-game/index.ts";
import { handler as joinGameHandler } from "../join-game/index.ts";
import { handler as leaveGameHandler } from "../leave-game/index.ts";
import { handler as endGameHandler } from "../end-game/index.ts";
import { handler as startGameHandler } from "../start-game/index.ts";
import { handler as toggleReadyHandler } from "../toggle-ready/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

Deno.test({
  name: "Backend E2E - Full Lifecycle (Create -> Join -> Leave -> End)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // 1. Sign in two users
  const { data: hostData, error: hostAuthError } = await supabase.auth.signInAnonymously();
  if (hostAuthError || !hostData.session || !hostData.user) throw hostAuthError || new Error("Host auth failed");
  const hostToken = hostData.session.access_token;
  const hostId = hostData.user.id;

  const { data: guestData, error: guestAuthError } = await supabase.auth.signInAnonymously();
  if (guestAuthError || !guestData.session || !guestData.user) throw guestAuthError || new Error("Guest auth failed");
  const guestToken = guestData.session.access_token;
  // deno-lint-ignore no-unused-vars
  const guestId = guestData.user.id;

  let gameId = "";
  let roomCode = "";

  try {
    // 2. Create Game (Host)

    const hostName = `Host_${Math.random().toString(36).substring(7)}`;
    const createReq = new Request("http://localhost/create-game", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${hostToken}`,
        "Content-Type": "application/json"
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

    // 3. Join Game (Guest)
    const guestName = `Guest_${Math.random().toString(36).substring(7)}`;
    const joinReq = new Request("http://localhost/join-game", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${guestToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ roomCode, playerName: guestName }),
    });
    const joinRes = await joinGameHandler(joinReq);
    assertEquals(joinRes.status, 200);

    // 4. Verify both players are in the game
    const { data: playersBefore } = await supabase
      .from("game_players")
      .select("user_id")
      .eq("game_id", gameId);
    assertEquals(playersBefore?.length, 2);

    // 4.5. Start Game (Host)
    // Both players must be ready
    const readyReq1 = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: { "Authorization": `Bearer ${hostToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, isReady: true }),
    });
    const readyRes1 = await toggleReadyHandler(readyReq1);
    assertEquals(readyRes1.status, 200);

    const readyReq2 = new Request("http://localhost/toggle-ready", {
        method: "POST",
        headers: { "Authorization": `Bearer ${guestToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, isReady: true }),
    });
    const readyRes2 = await toggleReadyHandler(readyReq2);
    assertEquals(readyRes2.status, 200);

    const startReq = new Request("http://localhost/start-game", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${hostToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ gameId }),
    });
    const startRes = await startGameHandler(startReq);
    assertEquals(startRes.status, 200);
    const startBody = await startRes.json();
    assertEquals(startBody.success, true);

    // 5. Leave Game (Guest)
    const leaveReq = new Request("http://localhost/leave-game", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${guestToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ gameId }),
    });
    const leaveRes = await leaveGameHandler(leaveReq);
    assertEquals(leaveRes.status, 200);
    const leaveBody = await leaveRes.json();
    assertEquals(leaveBody.success, true);

    // 6. Verify Guest is removed
    const { data: playersAfterLeave } = await supabase
      .from("game_players")
      .select("user_id")
      .eq("game_id", gameId);
    assertEquals(playersAfterLeave?.length, 1);
    assertEquals(playersAfterLeave?.[0].user_id, hostId);

    // 7. End Game (Host)
    const endReq = new Request("http://localhost/end-game", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${hostToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ gameId }),
    });
    const endRes = await endGameHandler(endReq);
    assertEquals(endRes.status, 200);
    const endBody = await endRes.json();
    assertEquals(endBody.success, true);

    // 8. Verify Game is deleted
    const { data: gameAfterEnd } = await supabase
      .from("games")
      .select("id")
      .eq("id", gameId)
      .maybeSingle();
    assertEquals(gameAfterEnd, null);

  } finally {
    // Cleanup if something failed
    if (gameId) {
      const supabaseAdmin = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await supabaseAdmin.from("games").delete().eq("id", gameId);
    }
  }
  }
});
