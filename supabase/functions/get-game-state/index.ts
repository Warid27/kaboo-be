import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@^2.39.0"
import { corsHeaders } from "../_shared/cors.ts"
import { sanitizeState } from "../_shared/game-rules.ts"
import { GameState } from "../_shared/types.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Auth Check
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    // 2. Parse Body or Query Params
    // Supporting GET with query param or POST with body
    let gameId: string | null = null;
    
    if (req.method === 'GET') {
        const url = new URL(req.url);
        gameId = url.searchParams.get('gameId');
    } else {
        const body = await req.json().catch(() => ({}));
        gameId = body.gameId;
    }

    if (!gameId) throw new Error('Missing gameId')

    // 3. Fetch Game State (from secrets)
    const { data: secretData, error: fetchError } = await supabaseAdmin
      .from('game_secrets')
      .select('game_state')
      .eq('game_id', gameId)
      .single()

    if (fetchError || !secretData) throw new Error('Game not found')

    const currentState = secretData.game_state as GameState

    // 4. Validate User is in Game
    // We can check if user.id is in currentState.players
    if (!currentState.players[user.id]) throw new Error('You are not in this game')

    // 5. Return Sanitized State
    const safeState = sanitizeState(currentState, user.id);

    return new Response(
      JSON.stringify({ game_state: safeState }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
