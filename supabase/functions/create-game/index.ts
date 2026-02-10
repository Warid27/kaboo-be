import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@^2.39.0"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    // Generate Room Code (4 chars)
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    // Create Game
    const { data: game, error: gameError } = await supabaseClient
      .from('games')
      .insert({
        room_code: roomCode,
        created_by: user.id,
        status: 'waiting'
      })
      .select()
      .single()

    if (gameError) throw gameError

    // Create Game Secrets (Admin)
    const { error: secretsError } = await supabaseAdmin
      .from('game_secrets')
      .insert({
        game_id: game.id,
        game_state: {}
      })

    if (secretsError) {
        // Rollback game creation? 
        // For now just throw, but ideally we should delete the game.
        await supabaseAdmin.from('games').delete().eq('id', game.id);
        throw secretsError;
    }

    // Fetch Profile for Name
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    
    const playerName = profile?.username || 'Host';

    // Add Creator as Player
    const { error: playerError } = await supabaseClient
      .from('game_players')
      .insert({
        game_id: game.id,
        user_id: user.id,
        player_name: playerName,
        position: 0,
        is_connected: true
      })

    if (playerError) throw playerError

    return new Response(
      JSON.stringify({ gameId: game.id, roomCode }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
