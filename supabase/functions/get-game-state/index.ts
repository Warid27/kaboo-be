// deno-lint-ignore no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { sanitizeState } from "../_shared/game-rules.ts"
import { GameState } from "../_shared/types.ts"

console.log("Get Game State Function Loaded");

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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Auth Check
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

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

    const rawState = secretData.game_state as unknown
    const isMissingState =
      !rawState ||
      (typeof rawState === 'object' && rawState !== null && Object.keys(rawState as Record<string, unknown>).length === 0)

    if (isMissingState) {
      return new Response(
        JSON.stringify({ game_state: { phase: 'lobby', players: {} } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const currentState = rawState as GameState

    // Robustness: Ensure players object exists
    if (!currentState.players) {
        currentState.players = {};
    }

    // Robustness: Ensure playerOrder exists
    if (!currentState.playerOrder && currentState.players) {
        currentState.playerOrder = Object.keys(currentState.players);
    } else if (!currentState.playerOrder) {
        currentState.playerOrder = [];
    }

    // 4. Validate User is in Game
    // We can check if user.id is in currentState.players
    if (!currentState.players || !currentState.players[user.id]) {
        // Fallback: Check if game is waiting (lobby) and just return basic state
        // Or check DB for player membership if state is empty
        const { data: playerCheck } = await supabaseAdmin
            .from('game_players')
            .select('id')
            .eq('game_id', gameId)
            .eq('user_id', user.id)
            .single();
            
        if (!playerCheck) throw new Error('You are not in this game');
        
        // If state is empty (new game), return empty structure
        if (!currentState.players) {
            return new Response(
                JSON.stringify({ game_state: { players: {} } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            )
        }
    }

    // 5. Return Sanitized State
    const safeState = sanitizeState(currentState, user.id);

    return new Response(
      JSON.stringify({ game_state: safeState }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error("Get Game State error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
};

if (import.meta.main) {
  Deno.serve(handler);
}
