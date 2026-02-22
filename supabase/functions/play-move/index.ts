import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { processMove, sanitizeState, getCardValue } from "../_shared/game-rules.ts"
import { GameAction, GameState, Card, Rank, Suit } from "../_shared/types.ts"

console.log("Play Move Function Loaded");

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

    const allowTestDeckOverride = Deno.env.get("ALLOW_TEST_DECK_OVERRIDE") === "true"

    // 3. Fetch Game Status & State
    // Check Status (Admin)
    const { data: game, error: gameError } = await supabaseAdmin
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

    if (!currentState.players[user.id]) throw new Error('You are not in this game')

    if (action.type === "SET_TEST_DECK") {
      if (!allowTestDeckOverride) {
        throw new Error("Test deck override disabled")
      }
      const cards = Array.isArray(action.cards) ? action.cards : []
      if (!cards.length) {
        throw new Error("SET_TEST_DECK requires cards array")
      }
      const newDeck: Card[] = cards.map((c: { rank: Rank; suit?: Suit }) => {
        const suit: Suit = c.suit ?? "hearts"
        const rank: Rank = c.rank
        const value = getCardValue(rank, suit)
        return {
          id: crypto.randomUUID(),
          suit,
          rank,
          value,
          faceUp: false,
          source: "deck",
        }
      })
      currentState.deck = newDeck
      const newState = currentState
      const { error: updateSecretError } = await supabaseAdmin
        .from('game_secrets')
        .update({ game_state: newState })
        .eq('game_id', gameId)

      if (updateSecretError) throw updateSecretError

      const { error: updateGameError } = await supabaseAdmin
        .from('games')
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('id', gameId)

      if (updateGameError) throw updateGameError

      return new Response(
        JSON.stringify({ success: true, game_state: sanitizeState(newState, user.id) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

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
};

if (import.meta.main) {
  Deno.serve(handler);
}
