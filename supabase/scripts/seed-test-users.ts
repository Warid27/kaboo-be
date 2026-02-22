// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const baseEmailsEnv = Deno.env.get("TEST_USER_EMAILS") ?? "";
const basePassword = Deno.env.get("TEST_USER_PASSWORD") ?? "";

type EmailPasswordPair = { email: string; password: string };

const pairs: EmailPasswordPair[] = [];

if (baseEmailsEnv && basePassword) {
  const emails = baseEmailsEnv
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const email of emails) {
    pairs.push({ email, password: basePassword });
  }
}

const envObject = Deno.env.toObject();
for (const [key, value] of Object.entries(envObject)) {
  if (!key.startsWith("TEST_USER_EMAILS_")) continue;
  const suffix = key.substring("TEST_USER_EMAILS_".length);
  const email = value.trim();
  if (!email) continue;
  const passwordKey = `TEST_USER_PASSWORD_${suffix}`;
  const password = envObject[passwordKey];
  if (!password) {
    console.warn(
      `Skipping ${key} because matching ${passwordKey} is missing`,
    );
    continue;
  }
  pairs.push({ email, password });
}

if (pairs.length === 0) {
  console.error(
    "No test users configured. Set TEST_USER_EMAILS/TEST_USER_PASSWORD or TEST_USER_EMAILS_N/TEST_USER_PASSWORD_N.",
  );
  Deno.exit(1);
}

const supabase = createClient(url, serviceKey);

for (const { email, password } of pairs) {
  console.log(`Seeding user: ${email}`);
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    if (
      error.message &&
      error.message.toLowerCase().includes("already registered")
    ) {
      console.log(`User already exists, skipping: ${email}`);
      continue;
    }
    console.error(`Failed to create user ${email}:`, error.message ?? error);
    continue;
  }

  console.log(`Created user ${email} with id ${data.user?.id}`);
}

console.log("Seed completed");
