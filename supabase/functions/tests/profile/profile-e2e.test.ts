// deno-lint-ignore-file no-import-prefix

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { handler as getProfileHandler } from "../../get-profile/index.ts";
import { handler as updateProfileHandler } from "../../update-profile/index.ts";
import { handler as createGameHandler } from "../../create-game/index.ts";
import { hasServiceRoleKey, hasSupabaseEnv, signInPlayer } from "../testUtils.ts";

Deno.test({
  name: "Profile - Get returns profile and history for authenticated user",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  fn: async () => {
    const { token, userId } = await signInPlayer();

    const playerName = `ProfileTestHost_${crypto.randomUUID().slice(0, 4)}`;

    const createReq = new Request("http://localhost/create-game", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ playerName }),
    });

    const createRes = await createGameHandler(createReq);
    assertEquals(createRes.status, 200);
    const created = await createRes.json();
    assertExists(created.gameId);

    const profileReq = new Request("http://localhost/get-profile", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    const profileRes = await getProfileHandler(profileReq);
    assertEquals(profileRes.status, 200);
    const body = await profileRes.json();

    assertExists(body.profile);
    assertEquals(body.profile.id, userId);
    assertEquals(typeof body.profile.username, "string");
    assertEquals(Object.prototype.hasOwnProperty.call(body.profile, "avatarUrl"), true);

    assertExists(body.stats);
    assertEquals(typeof body.stats.gamesPlayed, "number");
    assertEquals(typeof body.stats.totalScore, "number");

    assertExists(body.history);
    const historyArray = body.history as unknown[];
    assertEquals(Array.isArray(historyArray), true);
  },
});

Deno.test({
  name: "Profile - Update changes username and avatar",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  fn: async () => {
    const { token, userId } = await signInPlayer();

    const newUsername = `UpdatedUser_${crypto.randomUUID().slice(0, 4)}`;

    const updateReq = new Request("http://localhost/update-profile", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: newUsername,
        avatarUrl: "https://example.com/avatar.png",
      }),
    });

    const updateRes = await updateProfileHandler(updateReq);
    assertEquals(updateRes.status, 200);
    const updatedBody = await updateRes.json();

    assertExists(updatedBody.profile);
    assertEquals(updatedBody.profile.id, userId);
    assertEquals(updatedBody.profile.username, newUsername);
    assertEquals(updatedBody.profile.avatarUrl, "https://example.com/avatar.png");

    const profileReq = new Request("http://localhost/get-profile", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    const profileRes = await getProfileHandler(profileReq);
    assertEquals(profileRes.status, 200);
    const profileBody = await profileRes.json();

    assertEquals(profileBody.profile.id, userId);
    assertEquals(profileBody.profile.username, newUsername);
    assertEquals(profileBody.profile.avatarUrl, "https://example.com/avatar.png");
  },
});
