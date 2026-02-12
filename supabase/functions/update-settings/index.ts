// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) throw new Error('Unauthorized');

    const { gameId, settings } = await req.json();

    // 1. Verify user is host
    const { data: game, error: gameError } = await supabaseAdmin
      .from('games')
      .select('created_by')
      .eq('id', gameId)
      .single();

    if (gameError || !game) throw new Error('Game not found');
    if (game.created_by !== user.id) throw new Error('Only the host can update settings');

    // 2. Fetch current state
    const { data: secretData, error: secretError } = await supabaseAdmin
      .from('game_secrets')
      .select('game_state')
      .eq('game_id', gameId)
      .single();

    if (secretError || !secretData) throw new Error('Game state not found');

    const gameState = secretData.game_state;
    
    // 3. Update settings
    gameState.settings = {
        ...gameState.settings,
        ...settings
    };

    // 4. Save back
    const { error: updateError } = await supabaseAdmin
        .from('game_secrets')
        .update({ game_state: gameState })
        .eq('game_id', gameId);

    if (updateError) throw updateError;

    // 5. Trigger Realtime Update
    await supabaseAdmin
        .from('games')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', gameId);

    return new Response(
      JSON.stringify({ success: true, settings: gameState.settings }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error("Update Settings error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
