// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Toggle Ready Function Loaded");

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
    let gameId, isReady;
    try {
        const text = await req.text();
        const body = JSON.parse(text);
        gameId = body.gameId;
        isReady = body.isReady;
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
        auth: {
          persistSession: false
        }
      }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Fetch Game Secrets
    const { data: secretData, error: secretError } = await supabaseAdmin
      .from('game_secrets')
      .select('game_state')
      .eq('game_id', gameId)
      .single();

    if (secretError || !secretData) throw new Error('Game not found');

    const gameState = secretData.game_state;
    
    // Validate player exists
    if (!gameState.players || !gameState.players[user.id]) {
        throw new Error('Player not in game');
    }

    // Update readiness
    gameState.players[user.id].isReady = isReady;

    // Save back
    const { error: updateError } = await supabaseAdmin
        .from('game_secrets')
        .update({ game_state: gameState })
        .eq('game_id', gameId);

    if (updateError) throw updateError;

    // Trigger Realtime Update by touching games table
    await supabaseAdmin
        .from('games')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', gameId);

    return new Response(
      JSON.stringify({ success: true, isReady }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error("Toggle Ready error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
