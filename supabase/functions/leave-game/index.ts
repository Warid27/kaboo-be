// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Leave Game Function Loaded");

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
    let gameId;
    try {
        const text = await req.text();
        if (text) {
          const body = JSON.parse(text);
          gameId = body.gameId;
        }
    // deno-lint-ignore no-unused-vars
    } catch (e) {
        throw new Error('Invalid request body');
    }

    if (!gameId) throw new Error('Game ID required')

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

    // Find Game
    const { data: game, error: gameError } = await supabaseClient
      .from('games')
      .select('id, status, created_by')
      .eq('id', gameId)
      .single()

    if (gameError || !game) throw new Error('Game not found')

    // Handle based on status
    if (game.status === 'waiting') {
        // Remove player from game_players
        await supabaseAdmin
            .from('game_players')
            .delete()
            .eq('game_id', gameId)
            .eq('user_id', user.id);

        let newHostId: string | null = null;

        // Check for Host Migration
        if (game.created_by === user.id) {
            // Find new host (oldest remaining player)
            const { data: remainingPlayers } = await supabaseAdmin
                .from('game_players')
                .select('user_id')
                .eq('game_id', gameId)
                .order('created_at', { ascending: true })
                .limit(1);

            if (remainingPlayers && remainingPlayers.length > 0) {
                newHostId = remainingPlayers[0].user_id;
                console.log(`Host left. Migrating host to ${newHostId}`);
                
                await supabaseAdmin
                    .from('games')
                    .update({ created_by: newHostId })
                    .eq('id', gameId);
            } else {
                // No players left, clean up game
                console.log('Last player left. Deleting game.');
                await supabaseAdmin.from('game_secrets').delete().eq('game_id', gameId);
                await supabaseAdmin.from('games').delete().eq('id', gameId);
                
                return new Response(
                    JSON.stringify({ success: true, message: 'Game deleted' }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
                );
            }
        }

        // Update game_secrets
        const { data: secretData } = await supabaseAdmin
            .from('game_secrets')
            .select('game_state')
            .eq('game_id', gameId)
            .single();

        if (secretData && secretData.game_state) {
            const gameState = secretData.game_state;
            
            // Remove from players
            if (gameState.players && gameState.players[user.id]) {
                delete gameState.players[user.id];
            }
            
            // Remove from playerOrder
            if (gameState.playerOrder) {
                gameState.playerOrder = gameState.playerOrder.filter((id: string) => id !== user.id);
            }

            // Sync Host in State
            if (newHostId && gameState.players && gameState.players[newHostId]) {
                 gameState.players[newHostId].isHost = true;
            }

            // Save back
            await supabaseAdmin
                .from('game_secrets')
                .update({ game_state: gameState })
                .eq('game_id', gameId);
        }

        // Touch games table to trigger subscription
        await supabaseAdmin
            .from('games')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', gameId);

    } else {
        // Just mark disconnected
        const { data: secretData } = await supabaseAdmin
            .from('game_secrets')
            .select('game_state')
            .eq('game_id', gameId)
            .single();

        if (secretData && secretData.game_state) {
            const gameState = secretData.game_state;
            if (gameState.players && gameState.players[user.id]) {
                gameState.players[user.id].isConnected = false;
                
                await supabaseAdmin
                .from('game_secrets')
                .update({ game_state: gameState })
                .eq('game_id', gameId);
            }
        }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
