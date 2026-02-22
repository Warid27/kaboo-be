// deno-lint-ignore-file no-import-prefix

import { createClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const hasSupabaseEnv =
  SUPABASE_URL.length > 0 &&
  SUPABASE_ANON_KEY.length > 0 &&
  !SUPABASE_URL.includes("placeholder") &&
  !SUPABASE_ANON_KEY.includes("placeholder");

export const hasServiceRoleKey =
  SUPABASE_SERVICE_ROLE_KEY.length > 0 &&
  !SUPABASE_SERVICE_ROLE_KEY.includes("placeholder");

export const supabase = hasSupabaseEnv
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null as unknown as ReturnType<typeof createClient>;

function getTestUserEmails() {
  const emails: string[] = [];
  const base = (Deno.env.get("TEST_USER_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  emails.push(...base);
  const envObject = Deno.env.toObject();
  for (const [key, value] of Object.entries(envObject)) {
    if (!key.startsWith("TEST_USER_EMAILS_")) continue;
    const email = value.trim();
    if (!email) continue;
    emails.push(email);
  }
  return Array.from(new Set(emails));
}

export const TEST_USER_EMAILS = getTestUserEmails();
const TEST_USER_PASSWORD = Deno.env.get("TEST_USER_PASSWORD") ?? "";

function getPasswordForEmail(email: string): string {
  if (TEST_USER_PASSWORD) return TEST_USER_PASSWORD;
  const envObject = Deno.env.toObject();
  for (const [key, value] of Object.entries(envObject)) {
    if (!key.startsWith("TEST_USER_EMAILS_")) continue;
    const configuredEmail = value.trim();
    if (configuredEmail !== email) continue;
    const suffix = key.substring("TEST_USER_EMAILS_".length);
    const passwordKey = `TEST_USER_PASSWORD_${suffix}`;
    const rawPassword = envObject[passwordKey];
    if (rawPassword && rawPassword.trim().length > 0) {
      return rawPassword.trim();
    }
  }
  throw new Error(
    `No TEST_USER_PASSWORD or TEST_USER_PASSWORD_N found for email ${email}`,
  );
}

let testUserIndex = 0;
const sessionCache = new Map<string, { token: string; userId: string }>();

export async function signInTestUser() {
  if (!hasSupabaseEnv) {
    throw new Error("Supabase environment is not configured");
  }
  const emailCount = TEST_USER_EMAILS.length;

  if (emailCount > 0) {
    const index = testUserIndex++ % emailCount;
    const email = TEST_USER_EMAILS[index];
    const password = getPasswordForEmail(email);
    const key = `email:${email}`;
    const cached = sessionCache.get(key);
    if (cached) {
      return cached;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session || !data.user) throw error || new Error("Auth failed");
    const session = { token: data.session.access_token, userId: data.user.id };
    sessionCache.set(key, session);
    return session;
  }

  const anonKey = "anon";
  const cachedAnon = sessionCache.get(anonKey);
  if (cachedAnon) {
    return cachedAnon;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session || !data.user) throw error || new Error("Auth failed");
  const anonSession = { token: data.session.access_token, userId: data.user.id };
  sessionCache.set(anonKey, anonSession);
  return anonSession;
}

export async function signInPlayer() {
  return await signInTestUser();
}

