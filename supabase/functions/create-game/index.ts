// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Create Game Function Loaded");

Deno.serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error("Missing Authorization header");
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    console.log("Auth Header length:", authHeader.length);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      console.error("Auth error details:", userError);
      console.error("User object:", user);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Generate Room Code (4 chars)
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    // Ensure Profile Exists
    let { data: profile } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    
    if (!profile) {
        console.log("Profile missing, creating default profile for:", user.id);
        const username = user.email?.split('@')[0] || `Player_${Math.random().toString(36).substring(2, 6)}`;
        
        const { data: newProfile, error: profileError } = await supabaseClient
            .from('profiles')
            .insert({
                id: user.id,
                username: username
            })
            .select()
            .single();
            
        if (profileError) {
            console.error("Failed to create profile:", profileError);
            throw new Error("Failed to create user profile");
        }
        profile = newProfile;
    }

    const playerName = profile?.username || 'Host';

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
        // Rollback game creation
        await supabaseAdmin.from('games').delete().eq('id', game.id);
        throw secretsError;
    }

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
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
