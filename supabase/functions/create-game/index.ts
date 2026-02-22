// deno-lint-ignore-file no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Create Game Function Loaded");

export const handler = async (req: Request): Promise<Response> => {
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      console.error("Auth error details:", userError);
      console.error("User object:", user);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Parse Request Body for Player Name
    let reqPlayerName = 'Host';
    try {
        const text = await req.text();
        if (text) {
             const body = JSON.parse(text);
             if (body.playerName) reqPlayerName = body.playerName;
        }
    } catch (e) {
        console.error("Body parsing error:", e);
    }

    // Generate Room Code (4 chars)
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    // Ensure Profile Exists
    let { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    
    if (!profile) {
        console.log("Profile missing, creating default profile for:", user.id);
        const username = user.email?.split('@')[0] || `Player_${Math.random().toString(36).substring(2, 6)}`;
        
        // Use Admin client to create profile for anonymous users to bypass potential RLS issues
        const { data: newProfile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: user.id,
                username: username
            })
            .select()
            .single();
            
        if (profileError) {
            console.error("Failed to create profile:", profileError);
            // Don't fail the game creation if profile creation fails, just fallback
        } else {
            profile = newProfile;
        }
    }

    const playerName = reqPlayerName !== 'Host' ? reqPlayerName : (profile?.username || 'Host');

    // Create Game
    const { data: game, error: gameError } = await supabaseAdmin
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
    const initialState = {
      roomCode: roomCode,
      phase: 'lobby',
      settings: {
        turnTimer: '30',
        mattsPairsRule: false,
        useEffectCards: true,
        numPlayers: 4,
        botDifficulty: 'medium',
        targetScore: '100'
      },
      players: {
        [user.id]: {
          id: user.id,
          name: playerName,
          ready: true,
          position: 0,
          hand: [],
          score: 0,
          isHost: true
        }
      },
      playerOrder: [user.id]
    };

    const { error: secretsError } = await supabaseAdmin
      .from('game_secrets')
      .insert({
        game_id: game.id,
        game_state: initialState
      })

    if (secretsError) {
        // Rollback game creation
        await supabaseAdmin.from('games').delete().eq('id', game.id);
        throw secretsError;
    }

    // Add Host as Player
    const { data: player, error: playerError } = await supabaseAdmin
      .from('game_players')
      .insert({
        game_id: game.id,
        user_id: user.id,
        player_name: playerName,
        position: 0,
        is_connected: true
      })
      .select()
      .single()

    if (playerError) {
        // Rollback secrets and game
        await supabaseAdmin.from('game_secrets').delete().eq('game_id', game.id);
        await supabaseAdmin.from('games').delete().eq('id', game.id);
        throw playerError;
    }

    return new Response(
      JSON.stringify({ 
          gameId: game.id, 
          roomCode,
          playerId: player.id,
          playerName: player.player_name
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
};

if (import.meta.main) {
  Deno.serve(handler);
}
