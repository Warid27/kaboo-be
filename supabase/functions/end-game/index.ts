// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("End Game Function Loaded");

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

    // Find Game and verify host
    const { data: game, error: gameError } = await supabaseAdmin
      .from('games')
      .select('id, created_by')
      .eq('id', gameId)
      .single()

    if (gameError || !game) throw new Error('Game not found')

    // Only host can end game
    if (game.created_by !== user.id) {
        throw new Error('Only the host can end the game')
    }

    console.log(`Host ${user.id} is ending game ${gameId}`);

    // Hard Delete: This will trigger a notification to all players (via record deletion)
    // and cleanup all associated data.
    
    // 1. Delete secrets
    await supabaseAdmin.from('game_secrets').delete().eq('game_id', gameId);
    
    // 2. Delete players (cascade might handle this, but let's be explicit)
    await supabaseAdmin.from('game_players').delete().eq('game_id', gameId);
    
    // 3. Delete game
    const { error: deleteError } = await supabaseAdmin.from('games').delete().eq('id', gameId);

    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({ success: true, message: 'Game ended and deleted' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
