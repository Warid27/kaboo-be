// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { handler as getProfileHandler } from "../../get-profile/index.ts";
import { handler as updateProfileHandler } from "../../update-profile/index.ts";
import { hasServiceRoleKey, hasSupabaseEnv } from "../testUtils.ts";

Deno.test({
  name: "Profile - Get rejects invalid token",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const req = new Request("http://localhost/get-profile", {
      method: "GET",
      headers: {
        "Authorization": "Bearer invalid-token",
      },
    });

    const res = await getProfileHandler(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "Unauthorized");
  },
});

Deno.test({
  name: "Profile - Update rejects invalid token",
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !hasSupabaseEnv || !hasServiceRoleKey,
  async fn() {
    const req = new Request("http://localhost/update-profile", {
      method: "POST",
      headers: {
        "Authorization": "Bearer invalid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "TestUser" }),
    });

    const res = await updateProfileHandler(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "Unauthorized");
  },
});
