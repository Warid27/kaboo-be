
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { initializeGame, processMove, sanitizeState } from "./game-rules.ts";
import { GameState, GameAction } from "./types.ts";

Deno.test("Full Game Simulation", () => {
    const p1 = "user1";
    const p2 = "user2";
    const p3 = "user3";
    const playerIds = [p1, p2, p3];
    const roomCode = "TEST";

    // 1. Initialize
    let state = initializeGame(playerIds, roomCode, {});
    assertEquals(state.phase, 'initial_look');
    assertEquals(state.playerOrder.length, 3);
    
    // Determine dynamic order
    const order = state.playerOrder;
    console.log("Player Order:", order);
    
    const u1 = order[0];
    const u2 = order[1];
    const u3 = order[2];

    // Mark players as ready to move to 'playing' phase
    state = processMove(state, { type: 'READY_TO_PLAY' }, u1).state;
    state = processMove(state, { type: 'READY_TO_PLAY' }, u2).state;
    state = processMove(state, { type: 'READY_TO_PLAY' }, u3).state;
    assertEquals(state.phase, 'playing');
    
    // Verify initial turn
    assertEquals(state.currentTurnUserId, u1);
    
    // Verify Sanitization (u1 viewing)
    const sanitizedForU1 = sanitizeState(state, u1);
    assertEquals(sanitizedForU1.players[u2].cards[0].value, 0); // Masked
    
    // 2. U1 Turn: Draw from Deck
    console.log(`\n--- ${u1} Turn: Draw from Deck ---`);
    // Force Safe Card for U1
    state.deck[0] = { 
        id: "safe-u1", suit: 'clubs', rank: '4', value: 4, faceUp: false, source: 'deck' 
    };

    let result = processMove(state, { type: 'DRAW_FROM_DECK' }, u1);
    state = result.state;
    
    assertEquals(state.turnPhase, 'action');
    assertNotEquals(state.drawnCard, null);
    console.log(`${u1} drew: ${state.drawnCard?.rank} of ${state.drawnCard?.suit}`);

    // 3. U1 Action: Discard Drawn
    console.log(`--- ${u1} Action: Discard Drawn ---`);
    result = processMove(state, { type: 'DISCARD_DRAWN' }, u1);
    state = result.state;
    
    // Turn should advance to U2
    assertEquals(state.currentTurnUserId, u2);
    assertEquals(state.turnPhase, 'draw');

    // 4. U2 Turn: Draw from Discard (Swap with Own)
    console.log(`\n--- ${u2} Turn: Draw from Discard (Swap) ---`);
    const topDiscard = state.discardPile[state.discardPile.length - 1];
    
    result = processMove(state, { type: 'DRAW_FROM_DISCARD' }, u2);
    state = result.state;
    assertEquals(state.drawnCard?.id, topDiscard.id);
    
    // U2 Swaps with their 1st card (index 0)
    result = processMove(state, { type: 'SWAP_WITH_OWN', cardIndex: 0 }, u2);
    state = result.state;
    
    // Verify Swap
    const newTopDiscard = state.discardPile[state.discardPile.length - 1];
    assertEquals(state.players[u2].cards[0].id, topDiscard.id);
    
    // Turn advances to U3
    assertEquals(state.currentTurnUserId, u3);

    // 5. U3 Turn: Draw and Play Effect (Mocking a 7/8 for PEEK_OWN)
    console.log(`\n--- ${u3} Turn: Effect (Mocked 7) ---`);
    state.deck[0] = { 
        id: "mock-7", suit: 'hearts', rank: '7', value: 7, faceUp: false, source: 'deck' 
    };
    
    result = processMove(state, { type: 'DRAW_FROM_DECK' }, u3);
    state = result.state;
    assertEquals(state.drawnCard?.rank, '7');
    
    result = processMove(state, { type: 'DISCARD_DRAWN' }, u3);
    state = result.state;
    
    // Should be in effect phase
    assertEquals(state.turnPhase, 'effect');
    assertEquals(state.pendingEffect?.type, 'PEEK_OWN');
    
    // Resolve Effect: Peek Own Card 1
    result = processMove(state, { type: 'PEEK_OWN', cardIndex: 1 }, u3);
    state = result.state;
    const peekedCard = result.result;
    console.log(`${u3} Peeked: ${peekedCard.rank}`);
    
    // Turn advances to U1
    assertEquals(state.currentTurnUserId, u1);
    
    // 6. U1 Calls Kaboo
    console.log(`\n--- ${u1} Calls Kaboo ---`);
    result = processMove(state, { type: 'CALL_KABOO' }, u1);
    state = result.state;
    
    assertEquals(state.kabooCallerId, u1);
    assertEquals(state.turnPhase, 'draw');
    // Turn should be U2
    assertEquals(state.currentTurnUserId, u2);
    // Turns Left should be 2 (U2 and U3 get one turn)
    assertEquals(state.turnsLeftAfterKaboo, 2);
    
    // 7. U2 Plays final turn
    console.log(`--- ${u2} Final Turn ---`);
    // Force a safe card (e.g. 2 of diamonds) to ensure no effect triggers
    state.deck[0] = { 
        id: "safe-card-1", suit: 'diamonds', rank: '2', value: 2, faceUp: false, source: 'deck' 
    };
    
    processMove(state, { type: 'DRAW_FROM_DECK' }, u2);
    result = processMove(state, { type: 'DISCARD_DRAWN' }, u2); 
    state = result.state;
    
    // Turns Left -> 1
    assertEquals(state.turnsLeftAfterKaboo, 1);
    assertEquals(state.currentTurnUserId, u3);
    
    // 8. U3 Plays final turn
    console.log(`--- ${u3} Final Turn ---`);
    // Force a safe card
    state.deck[0] = { 
        id: "safe-card-2", suit: 'diamonds', rank: '3', value: 3, faceUp: false, source: 'deck' 
    };
    
    processMove(state, { type: 'DRAW_FROM_DECK' }, u3);
    result = processMove(state, { type: 'DISCARD_DRAWN' }, u3);
    state = result.state;
    
    // 9. Game Over / Scoring
    console.log(`\n--- Scoring Phase ---`);
    assertEquals(state.phase, 'scoring');
    
    console.log("Final Scores:", state.players[u1].score, state.players[u2].score, state.players[u3].score);
    console.log("Last Action:", state.lastAction);
});
