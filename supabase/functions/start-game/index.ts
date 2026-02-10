import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@^2.39.0"
import { corsHeaders } from "../_shared/cors.ts"
import { initializeGame } from "../_shared/game-rules.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { gameId } = await req.json()
    if (!gameId) throw new Error('Game ID required')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    // Fetch Game
    const { data: game, error: gameError } = await supabaseClient
      .from('games')
      .select('id, created_by, status, room_code')
      .eq('id', gameId)
      .single()

    if (gameError || !game) throw new Error('Game not found')
    if (game.created_by !== user.id) throw new Error('Only host can start game')
    if (game.status !== 'waiting') throw new Error('Game already started')

    // Fetch Players
    const { data: players, error: playersError } = await supabaseClient
      .from('game_players')
      .select('user_id, player_name')
      .eq('game_id', gameId)
      .order('position', { ascending: true })

    if (playersError) throw playersError
    if (!players || players.length < 2) throw new Error('Need at least 2 players')

    const playerIds = players.map(p => p.user_id)

    // Initialize Game Logic
    const initialState = initializeGame(playerIds, game.room_code)

    // Update Player Names in State
    players.forEach(p => {
        if (initialState.players[p.user_id]) {
            initialState.players[p.user_id].name = p.player_name;
        }
    });

    // Update DB
    // 1. Update Secrets (Admin)
    const { error: secretsError } = await supabaseAdmin
        .from('game_secrets')
        .update({ game_state: initialState })
        .eq('game_id', gameId);
        
    if (secretsError) throw secretsError;

    // 2. Update Game Status
    const { error: updateError } = await supabaseClient
      .from('games')
      .update({
        status: 'playing',
        updated_at: new Date().toISOString()
      })
      .eq('id', gameId)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true, state: initialState }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
