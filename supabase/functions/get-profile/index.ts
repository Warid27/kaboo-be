import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Get Profile Function Loaded")

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

    const { data: profileRow, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, created_at")
      .eq("id", user.id)
      .maybeSingle()

    let profile = profileRow

    if (profileError && profileError.code !== "PGRST116") {
      return new Response(
        JSON.stringify({ error: "Failed to fetch profile" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      )
    }

    if (!profile) {
      const fallbackUsername = user.email?.split("@")[0] || `Player_${Math.random().toString(36).substring(2, 6)}`

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("profiles")
        .insert({
          id: user.id,
          username: fallbackUsername,
        })
        .select("id, username, avatar_url, created_at")
        .single()

      if (insertError || !inserted) {
        return new Response(
          JSON.stringify({ error: "Failed to create profile" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        )
      }

      profile = inserted
    }

    const { data: gameRows, error: gamesError } = await supabaseAdmin
      .from("game_players")
      .select("game_id, score, games(created_at, status)")
      .eq("user_id", user.id)
      .order("created_at", { foreignTable: "games", ascending: false })
      .limit(20)

    const safeRows = gamesError ? [] : (gameRows ?? [])

    const history = safeRows.map((row: any) => {
      const gameInfo = Array.isArray(row.games) ? row.games[0] : row.games
      return {
        gameId: row.game_id,
        status: gameInfo?.status ?? null,
        finalScore: row.score ?? null,
        playedAt: gameInfo?.created_at ?? null,
      }
    })

    const gamesPlayed = history.length
    const totalScore = history.reduce((sum, h) => (typeof h.finalScore === "number" ? sum + h.finalScore : sum), 0)
    const lastPlayedAt = history[0]?.playedAt ?? null

    const responseBody = {
      profile: {
        id: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url ?? null,
        createdAt: profile.created_at,
      },
      stats: {
        gamesPlayed,
        totalScore,
        lastPlayedAt,
      },
      history,
    }

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    )
  } catch (error) {
    console.error("Get Profile error:", error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    )
  }
}

if (import.meta.main) {
  Deno.serve(handler)
}
