// deno-lint-ignore-file no-import-prefix no-unused-vars
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { initializeGame } from "../_shared/game-rules.ts"

console.log("Start Game Function Loaded");

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

    let gameId;
    try {
        const text = await req.text();
        const body = JSON.parse(text);
        gameId = body.gameId;
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
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Fetch Game
    const { data: game, error: gameError } = await supabaseAdmin
      .from('games')
      .select('id, created_by, status, room_code')
      .eq('id', gameId)
      .single()

    if (gameError || !game) throw new Error('Game not found')
    if (game.created_by !== user.id) throw new Error('Only host can start game')
    if (game.status !== 'waiting') throw new Error('Game already started')

    // Fetch Players
    const { data: players, error: playersError } = await supabaseAdmin
      .from('game_players')
      .select('user_id, player_name')
      .eq('game_id', gameId)
      .order('position', { ascending: true })

    if (playersError) throw playersError
    if (!players || players.length < 2) throw new Error('Need at least 2 players')

    const playerIds = players.map(p => p.user_id)

    // Fetch current settings from secrets
    const { data: secretData, error: secretError } = await supabaseAdmin
        .from('game_secrets')
        .select('game_state')
        .eq('game_id', gameId)
        .single();
    
    if (secretError || !secretData) throw new Error('Game settings not found');
    const settings = secretData.game_state.settings;

    // Initialize Game Logic
    const initialState = initializeGame(playerIds, game.room_code, settings)

    // Update Player Names in State
    players.forEach(p => {
        if (initialState.players[p.user_id]) {
            initialState.players[p.user_id].name = p.player_name;
            initialState.players[p.user_id].isHost = (p.user_id === game.created_by);
        }
    });

    // Update DB
    // 1. Update Secrets (Admin)
    const { error: secretsError } = await supabaseAdmin
        .from('game_secrets')
        .update({ game_state: initialState })
        .eq('game_id', gameId);
        
    if (secretsError) throw secretsError;

    // 2. Update Game Status (Use Admin to bypass RLS)
    const { error: updateError } = await supabaseAdmin
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
    console.error("Start Game error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
};

if (import.meta.main) {
  Deno.serve(handler);
}
