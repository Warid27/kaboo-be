// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Kick Player Function Loaded");

export const handler = async (req: Request): Promise<Response> => {
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

    let gameId: string;
    let playerIdToKick: string;
    try {
      const text = await req.text();
      if (!text) throw new Error('Empty request body');
      const body = JSON.parse(text);
      gameId = body.gameId;
      playerIdToKick = body.playerId;
    } catch (_) {
      throw new Error('Invalid request body');
    }

    if (!gameId) throw new Error('Game ID required');
    if (!playerIdToKick) throw new Error('Player ID to kick required');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const { data: game, error: gameError } = await supabaseAdmin
      .from('games')
      .select('id, status, created_by')
      .eq('id', gameId)
      .single();

    if (gameError || !game) throw new Error('Game not found');

    if (game.created_by !== user.id) {
      throw new Error('Only the host can kick players');
    }

    if (playerIdToKick === user.id) {
      throw new Error('You cannot kick yourself. Use leave game instead.');
    }

    if (game.status !== 'waiting') {
      throw new Error('Can only kick players in the lobby');
    }

    const { error: deletePlayerError } = await supabaseAdmin
      .from('game_players')
      .delete()
      .eq('game_id', gameId)
      .eq('user_id', playerIdToKick);

    if (deletePlayerError) throw deletePlayerError;

    const { data: secretData } = await supabaseAdmin
      .from('game_secrets')
      .select('game_state')
      .eq('game_id', gameId)
      .single();

    if (secretData && secretData.game_state) {
      const gameState = secretData.game_state;

      if (gameState.players && gameState.players[playerIdToKick]) {
        delete gameState.players[playerIdToKick];
      }

      if (gameState.playerOrder) {
        gameState.playerOrder = gameState.playerOrder.filter((id: string) => id !== playerIdToKick);
      }

      await supabaseAdmin
        .from('game_secrets')
        .update({ game_state: gameState })
        .eq('game_id', gameId);
    }

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
};

if (import.meta.main) {
  Deno.serve(handler);
}

