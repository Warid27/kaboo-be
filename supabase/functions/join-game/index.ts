// deno-lint-ignore-file no-import-prefix
// deno-lint-ignore-file
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Join Game Function Loaded");

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
    let roomCode, reqPlayerName;
    try {
        const text = await req.text();
        const body = JSON.parse(text);
        roomCode = body.roomCode;
        reqPlayerName = body.playerName;
    // deno-lint-ignore no-unused-vars
    } catch (e) {
        throw new Error('Invalid request body');
    }

    if (!roomCode) throw new Error('Room code required')

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

    // Find Game
    const { data: game, error: gameError } = await supabaseClient
      .from('games')
      .select('id, status')
      .eq('room_code', roomCode.toUpperCase())
      .single()

    if (gameError || !game) throw new Error('Game not found')
    if (game.status !== 'waiting') throw new Error('Game already started')

    // Check if user already joined
    const { data: existingPlayer } = await supabaseClient
      .from('game_players')
      .select('id')
      .eq('game_id', game.id)
      .eq('user_id', user.id)
      .single()
      
    if (existingPlayer) {
         return new Response(
          JSON.stringify({ message: 'Already joined', gameId: game.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }

    // Get current player count for position
    const { count } = await supabaseClient
      .from('game_players')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', game.id)

    const position = count || 0;
    
    if (position >= 4) throw new Error('Game is full');

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
    
    const playerName = reqPlayerName || profile?.username || 'Player';

    // Join (Admin)
    const { data: player, error: joinError } = await supabaseAdmin
      .from('game_players')
      .insert({
        game_id: game.id,
        user_id: user.id,
        player_name: playerName,
        position: position,
        is_connected: true
      })
      .select()
      .single()

    if (joinError) throw joinError

    // Update Game Secrets to include new player
    try {
      const { data: secretData } = await supabaseAdmin
        .from('game_secrets')
        .select('game_state')
        .eq('game_id', game.id)
        .single();

      if (secretData && secretData.game_state) {
        const gameState = secretData.game_state;
        
        // Add player to state
        if (!gameState.players) gameState.players = {};
        gameState.players[user.id] = {
            id: user.id,
            name: playerName,
            isConnected: true,
            isReady: false,
            cards: [],
            score: 0,
            kabooCalled: false
        };
        
        // Add to playerOrder
        if (!gameState.playerOrder) gameState.playerOrder = [];
        if (!gameState.playerOrder.includes(user.id)) {
            gameState.playerOrder.push(user.id);
        }
        
        // Save back
        await supabaseAdmin
            .from('game_secrets')
            .update({ game_state: gameState })
            .eq('game_id', game.id);
      }
    } catch (e) {
      console.error("Failed to update game state:", e);
      // Non-fatal, but syncing will be delayed until next move
    }

    return new Response(
      JSON.stringify({ 
          gameId: game.id,
          playerId: player.id,
          playerName: player.player_name
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error("Join error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
