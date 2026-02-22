// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { handler as getProfileHandler } from "../../get-profile/index.ts";
import { handler as updateProfileHandler } from "../../update-profile/index.ts";

Deno.test("Profile - Get requires auth header", async () => {
  const req = new Request("http://localhost/get-profile", {
    method: "GET",
  });

  const res = await getProfileHandler(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Missing Authorization header");
});

Deno.test("Profile - Update requires auth header", async () => {
  const req = new Request("http://localhost/update-profile", {
    method: "POST",
    body: JSON.stringify({ username: "TestUser" }),
  });

  const res = await updateProfileHandler(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Missing Authorization header");
});
