import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { processMove, sanitizeState } from "../_shared/game-rules.ts"
import { GameAction, GameState } from "../_shared/types.ts"

console.log("Play Move Function Loaded");

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { 
        global: { headers: { Authorization: authHeader } },
        auth: {
          persistSession: false
        }
      }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Auth Check
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // 2. Parse Body
    let gameId, action;
    try {
        const text = await req.text();
        const body = JSON.parse(text);
        gameId = body.gameId;
        action = body.action;
    } catch (e) {
        throw new Error('Invalid request body');
    }

    if (!gameId || !action) throw new Error('Missing gameId or action')

    // 3. Fetch Game Status & State
    // Check Status (User)
    const { data: game, error: gameError } = await supabaseClient
      .from('games')
      .select('status')
      .eq('id', gameId)
      .single()

    if (gameError || !game) throw new Error('Game not found')
    if (game.status !== 'playing') throw new Error('Game is not active')

    // Fetch State (Admin)
    const { data: secretData, error: secretError } = await supabaseAdmin
      .from('game_secrets')
      .select('game_state')
      .eq('game_id', gameId)
      .single()

    if (secretError || !secretData) throw new Error('Game state not found')

    const currentState = secretData.game_state as GameState

    // 4. Process Move
    // Note: processMove mutates the state? Yes, my implementation mutates.
    // Ideally it should be immutable, but Deno memory is isolated per request.
    // However, I should be careful.
    
    // We need to pass the userId of the player making the move.
    // Ensure the user is part of the game?
    // The game state has players map.
    if (!currentState.players[user.id]) throw new Error('You are not in this game')

    const { state: newState, result } = processMove(currentState, action as GameAction, user.id)

    // 5. Update DB
    // Update Secrets (Admin)
    const { error: updateSecretError } = await supabaseAdmin
      .from('game_secrets')
      .update({ game_state: newState })
      .eq('game_id', gameId)

    if (updateSecretError) throw updateSecretError

    // Update Game timestamp (User or Admin? Admin to bypass RLS)
    const { error: updateGameError } = await supabaseAdmin
      .from('games')
      .update({
        updated_at: new Date().toISOString()
      })
      .eq('id', gameId)

    if (updateGameError) throw updateGameError

    return new Response(
      JSON.stringify({ success: true, game_state: sanitizeState(newState, user.id), result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error("Play Move error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
