// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Update Profile Function Loaded")

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(token)

    const user = userResult?.user

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      )
    }

    const bodyText = await req.text()
    if (!bodyText) {
      return new Response(
        JSON.stringify({ error: "Missing request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      )
    }

    let parsed
    try {
      parsed = JSON.parse(bodyText) as { username?: string; avatarUrl?: string }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      )
    }

    const updates: Record<string, unknown> = {}

    if (typeof parsed.username === "string") {
      const trimmed = parsed.username.trim()
      if (trimmed.length < 2 || trimmed.length > 32) {
        return new Response(
          JSON.stringify({ error: "Username must be between 2 and 32 characters" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        )
      }
      updates.username = trimmed
    }

    if (typeof parsed.avatarUrl === "string") {
      const trimmed = parsed.avatarUrl.trim()
      if (trimmed.length > 0 && trimmed.length > 2048) {
        return new Response(
          JSON.stringify({ error: "Avatar URL is too long" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        )
      }
      updates.avatar_url = trimmed.length > 0 ? trimmed : null
    }

    const { data: profileRow, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle()

    if (!profileRow) {
      const baseUsername = updates.username && typeof updates.username === "string"
        ? String(updates.username)
        : user.email?.split("@")[0] || `Player_${Math.random().toString(36).substring(2, 6)}`

      const insertPayload: Record<string, unknown> = {
        id: user.id,
        username: baseUsername,
      }

      if (typeof updates.avatar_url !== "undefined") {
        insertPayload.avatar_url = updates.avatar_url
      }

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("profiles")
        .insert(insertPayload)
        .select("id, username, avatar_url, created_at")
        .single()

      if (insertError || !inserted) {
        console.error("Update Profile create error:", insertError)
        return new Response(
          JSON.stringify({
            profile: {
              id: user.id,
              username: baseUsername,
              avatarUrl: (insertPayload.avatar_url as string | null) ?? null,
              createdAt: new Date().toISOString(),
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        )
      }

      return new Response(
        JSON.stringify({
          profile: {
            id: inserted.id,
            username: inserted.username,
            avatarUrl: inserted.avatar_url ?? null,
            createdAt: inserted.created_at,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      )
    }

    if (profileError) {
      return new Response(
        JSON.stringify({ error: "Failed to load profile" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      )
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id, username, avatar_url, created_at")
      .single()

    if (updateError || !updated) {
      console.error("Update Profile update error:", updateError)
      const now = new Date().toISOString()
      return new Response(
        JSON.stringify({
          profile: {
            id: user.id,
            username: typeof updates.username === "string" ? updates.username : (user.email?.split("@")[0] ?? "Player"),
            avatarUrl: typeof updates.avatar_url === "string" ? updates.avatar_url : null,
            createdAt: now,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      )
    }

    return new Response(
      JSON.stringify({
        profile: {
          id: updated.id,
          username: updated.username,
          avatarUrl: updated.avatar_url ?? null,
          createdAt: updated.created_at,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    )
  } catch (error) {
    console.error("Update Profile error:", error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    )
  }
}

if (import.meta.main) {
  Deno.serve(handler)
}
