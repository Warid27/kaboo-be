// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Kick Player Function Loaded");

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

    // Parse Body
    let gameId: string;
    let playerIdToKick: string;
    try {
        const text = await req.text();
        if (!text) throw new Error('Empty request body');
        const body = JSON.parse(text);
        gameId = body.gameId;
        playerIdToKick = body.playerId;
    } catch (e) {
        throw new Error('Invalid request body');
    }

    if (!gameId) throw new Error('Game ID required')
    if (!playerIdToKick) throw new Error('Player ID to kick required')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { 
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false }
      }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Find Game and verify host
    const { data: game, error: gameError } = await supabaseClient
      .from('games')
      .select('id, status, created_by')
      .eq('id', gameId)
      .single()

    if (gameError || !game) throw new Error('Game not found')
    
    // Only host can kick
    if (game.created_by !== user.id) {
        throw new Error('Only the host can kick players')
    }

    // Cannot kick yourself (use leave-game instead)
    if (playerIdToKick === user.id) {
        throw new Error('You cannot kick yourself. Use leave game instead.')
    }

    // Handle based on status
    // For now, only allow kicking in 'waiting' status (lobby)
    if (game.status !== 'waiting') {
        throw new Error('Can only kick players in the lobby')
    }

    // Remove player from game_players
    const { error: deletePlayerError } = await supabaseAdmin
        .from('game_players')
        .delete()
        .eq('game_id', gameId)
        .eq('user_id', playerIdToKick);

    if (deletePlayerError) throw deletePlayerError;

    // Update game_secrets
    const { data: secretData } = await supabaseAdmin
        .from('game_secrets')
        .select('game_state')
        .eq('game_id', gameId)
        .single();

    if (secretData && secretData.game_state) {
        const gameState = secretData.game_state;
        
        // Remove from players
        if (gameState.players && gameState.players[playerIdToKick]) {
            delete gameState.players[playerIdToKick];
        }
        
        // Remove from playerOrder
        if (gameState.playerOrder) {
            gameState.playerOrder = gameState.playerOrder.filter((id: string) => id !== playerIdToKick);
        }

        // Save back
        await supabaseAdmin
            .from('game_secrets')
            .update({ game_state: gameState })
            .eq('game_id', gameId);
    }

    // Touch games table to trigger subscription update for all players
    await supabaseAdmin
        .from('games')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', gameId);

    return new Response(
      JSON.stringify({ success: true, kickedPlayerId: playerIdToKick }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error("Kick Player error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
