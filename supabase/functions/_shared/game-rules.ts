// deno-lint-ignore-file prefer-const no-explicit-any
import { Card, GameState, PlayerState, Suit, Rank, GameAction } from './types.ts';

// --- Card Values & Generation ---

export const getCardValue = (rank: Rank, suit: Suit): number => {
  if (rank === 'joker') return -1;
  
  // Red Kings (Hearts/Diamonds) = 0
  // Black Kings (Spades/Clubs) = 13
  if (rank === 'K') {
      if (suit === 'hearts' || suit === 'diamonds') return 0;
      return 13;
  }

  // Red Jack/Queen = 0? 
  // Markdown says: "Red King, Jack, Queen (Hearts/Diamonds) | 0 | Best card"
  if ((rank === 'J' || rank === 'Q') && (suit === 'hearts' || suit === 'diamonds')) {
      return 0;
  }
  
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  
  return parseInt(rank, 10);
};

export const createDeck = (): Card[] => {
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  
  let deck: Card[] = [];
  
  // Standard 52 cards
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: crypto.randomUUID(),
        suit,
        rank,
        value: getCardValue(rank, suit),
        faceUp: false,
      });
    }
  }
  
  // Add 2 Jokers
  deck.push({ id: crypto.randomUUID(), suit: 'joker', rank: 'joker', value: -1, faceUp: false });
  deck.push({ id: crypto.randomUUID(), suit: 'joker', rank: 'joker', value: -1, faceUp: false });
  
  return shuffle(deck);
};

export const shuffle = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

// --- Game Logic ---

export const initializeGame = (playerIds: string[], roomCode: string, settings: any): GameState => {
  const deck = createDeck(); // This already calls shuffle(deck)
  const players: Record<string, PlayerState> = {};
  
  // Deal 4 cards to each player
  playerIds.forEach(pid => {
    const hand = deck.splice(0, 4);
    // Initially, players might be allowed to see 2 of their cards (depending on house rules)
    // For standard Kaboo, usually you peek at 2 at start. We'll handle that via 'peek' actions or set initial faceUp.
    // Let's keep them faceDown for now.
    
    players[pid] = {
      id: pid,
      name: 'Player ' + pid.substring(0, 4), // Placeholder
      isConnected: true,
      isReady: false,
      cards: hand,
      score: 0,
      kabooCalled: false
    };
  });
  
  // Start discard pile
  const firstDiscard = deck.shift();
  if (firstDiscard) {
    firstDiscard.faceUp = true;
  }
  const discardPile = firstDiscard ? [firstDiscard] : [];

  const playerOrder = shuffle([...playerIds]); // Randomize start order

    return {
      roomCode,
      phase: 'initial_look', // Start in initial_look phase
      settings,
      players,
      playerOrder,
      deck,
      discardPile,
      currentTurnUserId: playerOrder[0], // Start with the first player in the randomized order
      turnPhase: 'draw',
      drawnCard: null,
    pendingEffect: null,
    kabooCallerId: null,
    turnsLeftAfterKaboo: null,
    lastAction: 'Game Started',
  };
};

export const drawFromDeck = (state: GameState, userId: string): GameState => {
  if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
  if (state.turnPhase !== 'draw') throw new Error("Cannot draw in this phase");
  
  if (state.deck.length === 0) {
      // No deck reshuffle - Trigger Auto-Kaboo or Game End
      state.kabooCallerId = 'SYSTEM'; // Mark as auto-kaboo
      state.turnsLeftAfterKaboo = 0; // End immediately
      return endTurn(state);
  }
  
  const card = state.deck.shift();
  if (!card) throw new Error("Deck is empty");
  
  card.faceUp = true; // Player looks at it (private in reality, but logic-wise "held")
  card.source = 'deck';
  
  state.drawnCard = card;
  state.turnPhase = 'action';
  state.lastAction = 'Drew from deck';
  
  return state;
};

export const drawFromDiscard = (state: GameState, userId: string): GameState => {
  if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
  if (state.turnPhase !== 'draw') throw new Error("Cannot draw in this phase");
  if (state.discardPile.length === 0) throw new Error("Discard pile empty");
  
  const card = state.discardPile.pop()!;
  card.faceUp = true;
  card.source = 'discard'; 
  
  state.drawnCard = card;
  state.turnPhase = 'action';
  state.lastAction = 'Drew from discard';
  
  return state;
};

export const discardDrawnCard = (state: GameState, userId: string): GameState => {
    if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
    if (state.turnPhase !== 'action') throw new Error("Invalid phase");
    if (!state.drawnCard) throw new Error("No card drawn");
    if (state.drawnCard.source === 'discard') throw new Error("Cannot discard card drawn from discard pile");

    state.drawnCard.faceUp = true;
    state.discardPile.push(state.drawnCard);
    const playedCard = state.drawnCard;
    state.drawnCard = null;
    
    // Trigger effects if applicable
    return triggerCardEffect(state, playedCard);
};

const triggerCardEffect = (state: GameState, playedCard: Card): GameState => {
    // Check Powers
    const rank = playedCard.rank;
    let effectType: 'PEEK_OWN' | 'PEEK_OTHER' | 'SWAP_EITHER' | 'LOOK_AND_SWAP' | 'FULL_VISION_SWAP' | null = null;

    if (rank === '7' || rank === '8') effectType = 'PEEK_OWN';
    else if (rank === '9' || rank === '10') effectType = 'PEEK_OTHER';
    // Jack: Blind Swap
    else if (rank === 'J') effectType = 'SWAP_EITHER'; 
    // Queen: Semi-Blind Swap (Look & Swap)
    else if (rank === 'Q') effectType = 'LOOK_AND_SWAP'; 
    // King: Full Vision Swap
    else if (rank === 'K') effectType = 'FULL_VISION_SWAP'; 

    if (effectType) {
        state.turnPhase = 'effect';
        state.pendingEffect = { type: effectType, sourceCardRank: rank };
        state.lastAction = `Played ${rank} - Effect Triggered`;
        return state;
    }
    
    return endTurn(state);
};

export const resolveEffect = (
    state: GameState, 
    userId: string, 
    action: any
): { state: GameState, result?: any } => {
    if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
    if (state.turnPhase !== 'effect') throw new Error("Not in effect phase");
    if (!state.pendingEffect) throw new Error("No pending effect");

    const effect = state.pendingEffect.type;
    let result = null;

    if (effect === 'PEEK_OWN' || effect === 'PEEK_OTHER') {
        const targetPlayerId = action.targetPlayerId || (effect === 'PEEK_OWN' ? userId : null);
        const targetCardIndex = action.cardIndex;
        
        if (!targetPlayerId) throw new Error("Target player required");
        if (targetCardIndex === undefined) throw new Error("Card index required");
        
        const targetPlayer = state.players[targetPlayerId];
        if (!targetPlayer) throw new Error("Target player not found");
        if (!targetPlayer.cards[targetCardIndex]) throw new Error("Target card invalid");

        if (effect === 'PEEK_OWN' && targetPlayerId !== userId) throw new Error("Must peek own card");
        if (effect === 'PEEK_OTHER' && targetPlayerId === userId) throw new Error("Must peek other player's card");

        result = targetPlayer.cards[targetCardIndex];
        state.lastAction = effect === 'PEEK_OWN' ? `Peeked own card` : `Peeked ${targetPlayer.name}'s card`;
    } 
    else if (effect === 'SWAP_EITHER' || effect === 'LOOK_AND_SWAP' || effect === 'FULL_VISION_SWAP') {
        // Handle both old and new payload formats for compatibility
        let p1Id, c1Idx, p2Id, c2Idx;

        if (action.card1 && action.card2) {
            p1Id = action.card1.playerId;
            c1Idx = action.card1.cardIndex;
            p2Id = action.card2.playerId;
            c2Idx = action.card2.cardIndex;
        } else {
            // Fallback to old format
            p1Id = userId;
            c1Idx = action.ownCardIndex;
            p2Id = action.targetPlayerId;
            c2Idx = action.cardIndex;
        }

        if (p1Id && c1Idx !== undefined && p2Id && c2Idx !== undefined) {
            // Perform Swap
            const p1 = state.players[p1Id];
            const p2 = state.players[p2Id];
            if (!p1 || !p2) throw new Error("Players not found for swap");
            if (!p1.cards[c1Idx] || !p2.cards[c2Idx]) throw new Error("Invalid cards for swap");

            const card1 = p1.cards[c1Idx];
            const card2 = p2.cards[c2Idx];

            p1.cards[c1Idx] = card2;
            p2.cards[c2Idx] = card1;

            state.lastAction = `Swapped cards between ${p1.name} and ${p2.name}`;
        } else if (effect === 'LOOK_AND_SWAP' || effect === 'FULL_VISION_SWAP') {
             // Peek part of Look & Swap
             const targetPlayerId = action.targetPlayerId;
             const targetCardIndex = action.cardIndex;
             if (!targetPlayerId || targetCardIndex === undefined) throw new Error("Target required for peek");
             
             const targetPlayer = state.players[targetPlayerId];
             if (!targetPlayer) throw new Error("Target player not found");
             result = targetPlayer.cards[targetCardIndex];
             state.lastAction = `Peeked card during ${effect}`;
             
             // In LOOK_AND_SWAP or FULL_VISION_SWAP, we might stay in effect phase?
             // But current logic ends turn after one action. 
             // For now, let's keep it simple: one peek OR one swap.
        } else {
            throw new Error("Missing parameters for swap");
        }
    }

    state.pendingEffect = null;
    return { state: endTurn(state), result };
};

export const snapCard = (state: GameState, userId: string, cardIndex: number): GameState => {
    // "Tap" / "Snap" logic:
    // If you have a card matching the top discard, you can throw it in.
    if (state.discardPile.length === 0) throw new Error("No discard pile to snap to");
    
    const topDiscard = state.discardPile[state.discardPile.length - 1];
    const player = state.players[userId];
    
    if (!player) throw new Error("Player not found");
    if (!player.cards[cardIndex]) throw new Error("Invalid card");
    
    const card = player.cards[cardIndex];
    
    // Check Match (Rank match)
    if (card.rank === topDiscard.rank) {
        // Success Snap
        player.cards.splice(cardIndex, 1); // Remove from hand
        card.faceUp = true;
        state.discardPile.push(card); // Add to discard
        state.lastAction = `${player.name} snapped a ${card.rank}!`;
        
        // Note: Turn does not change!
        // If player has 0 cards now -> Trigger Last Round?
        // Usually Kaboo rules: If you run out of cards, the game ends or you are "safe"?
        // Or you just have 0 cards and wait.
        // Let's leave that for now.
    } else {
        // Fail Snap - Penalty?
        // Usually draw a card from deck as penalty.
        // Implementation:
        if (state.deck.length > 0) {
             const penaltyCard = state.deck.shift()!;
             penaltyCard.faceUp = false; // or true?
             player.cards.push(penaltyCard);
             state.lastAction = `${player.name} failed snap! Penalty card.`;
        } else {
             state.lastAction = `${player.name} failed snap! No deck left.`;
        }
    }
    
    return state;
};

export const swapWithOwn = (state: GameState, userId: string, cardIndex: number): GameState => {
    if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
    if (state.turnPhase !== 'action') throw new Error("Invalid phase");
    if (!state.drawnCard) throw new Error("No card drawn");
    
    const player = state.players[userId];
    if (!player) throw new Error("Player not found");
    if (cardIndex < 0 || cardIndex >= player.cards.length) throw new Error("Invalid card index");
    
    const oldCard = player.cards[cardIndex];
    player.cards[cardIndex] = state.drawnCard; // Put new card in slot
    player.cards[cardIndex].faceUp = false; // Face down in hand
    
    oldCard.faceUp = true;
    state.discardPile.push(oldCard); // Discard the old one
    state.drawnCard = null;
    
    state.lastAction = `Swapped card`;
    
    // Trigger effects if the swapped-out card has one
    return triggerCardEffect(state, oldCard);
};

export const callKaboo = (state: GameState, userId: string): GameState => {
    if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
    if (state.turnPhase !== 'draw') throw new Error("Cannot call Kaboo after drawing");
    if (state.kabooCallerId) throw new Error("Kaboo already called");
    
    state.kabooCallerId = userId;
    
    // Logic: 
    // If P1 calls. P2 plays, P3 plays. Back to P1 -> Score.
    // We initialize turnsLeft to playerOrder.length - 1?
    // Let's trace carefully.
    // 3 Players: [P1, P2, P3].
    // P1 calls.
    // We want P2 to play (1), P3 to play (2).
    // Total turns = 2.
    // Next player is P2.
    // P2 plays -> turnsLeft 2 -> 1. Next P3.
    // P3 plays -> turnsLeft 1 -> 0. Next P1.
    // P1 sees turnsLeft=0 && current=Caller -> Score.
    
    // So turnsLeftAfterKaboo should be (playerOrder.length - 1) IF we decrement at endTurn.
    // OR we set it to playerOrder.length and decrement?
    
    // My previous logic was: state.turnsLeftAfterKaboo = state.playerOrder.length; (3)
    // P1 calls. returns endTurn(state).
    // endTurn: decrements? NO. callKaboo calls endTurn.
    // endTurn: turnsLeft (3) -> 2. Next P2.
    // P2 plays. endTurn: turnsLeft (2) -> 1. Next P3.
    // P3 plays. endTurn: turnsLeft (1) -> 0. Next P1.
    // Check: turnsLeft==0 && current==P1 -> Score.
    
    // BUT the test failed saying Actual: 2, Expected: 3.
    // Ah, wait. In the test:
    // game = callKaboo(game, "p1");
    // assertEquals(game.turnsLeftAfterKaboo, 3);
    
    // If I set it to 3, and call endTurn...
    // endTurn:
    // if (state.turnsLeftAfterKaboo !== null) { state.turnsLeftAfterKaboo--; }
    // So 3 becomes 2.
    // So after callKaboo returns, it is 2.
    
    // If I want it to be 2 (P2, P3), then initializing to 3 is correct IF endTurn decrements.
    // So the test expectation was 3, but actual is 2.
    // Is 2 correct?
    // Remaining players: P2, P3. Count = 2.
    // So 2 is correct.
    
    state.turnsLeftAfterKaboo = state.playerOrder.length; 
    state.lastAction = `Called Kaboo!`;
    
    // IMPORTANT: Calling Kaboo consumes your turn immediately.
    // You do NOT draw or discard. The next player goes.
    return endTurn(state);
};

export const calculateScores = (state: GameState): GameState => {
    // 1. Calculate raw sums
    let minScore = Infinity;
    const scores: Record<string, number> = {};
    
    // First pass: sum cards
    for (const pid of state.playerOrder) {
        const player = state.players[pid];
        const sum = player.cards.reduce((acc, card) => acc + card.value, 0);
        scores[pid] = sum;
        if (pid !== state.kabooCallerId) {
             if (sum < minScore) minScore = sum;
        }
    }

    // 2. Apply Kaboo Penalty/Bonus
    if (state.kabooCallerId) {
        const callerScore = scores[state.kabooCallerId];
        // Caller must be STRICTLY lower than everyone else to avoid penalty.
        // If callerScore >= minOtherScore -> Penalty.
        if (callerScore > minScore) { // Wait, rules say "tied or higher" -> Penalty. So if caller == min, penalty?
             // Markdown: "If the Caller does not have the lowest score (tied or higher...)"
             // So STRICTLY lowest means caller < min.
             // If caller >= min, Penalty +20.
             scores[state.kabooCallerId] += 20;
             state.lastAction = "Kaboo Failed! +20 Penalty";
        } else if (callerScore === minScore) {
             // Tied -> Penalty?
             // Markdown: "If the Caller does not have the lowest score (tied or higher...)" -> YES Penalty.
             scores[state.kabooCallerId] += 20;
             state.lastAction = "Kaboo Tied! +20 Penalty";
        } else {
             // Caller < min -> Success (0 bonus, just raw score)
             state.lastAction = "Kaboo Success!";
        }
    }
    
    // Update state
    for (const pid of state.playerOrder) {
        state.players[pid].score += scores[pid]; // Add to cumulative score? Or round score?
        // Usually you track total score. Let's assume cumulative.
    }
    
    return state;
};

const endTurn = (state: GameState): GameState => {
    state.turnPhase = 'draw';
    
    // Check Game Over (Kaboo rounds finished)
    if (state.turnsLeftAfterKaboo !== null) {
        state.turnsLeftAfterKaboo--;
        if (state.turnsLeftAfterKaboo < 0) {
            state.phase = 'scoring';
            return calculateScores(state);
        }
    }
    
    // Advance player
    const currentIdx = state.playerOrder.indexOf(state.currentTurnUserId!);
    const nextIdx = (currentIdx + 1) % state.playerOrder.length;
    state.currentTurnUserId = state.playerOrder[nextIdx];
    
    // Kaboo Loop Check
    if (state.turnsLeftAfterKaboo === 0 && state.currentTurnUserId === state.kabooCallerId) {
         state.phase = 'scoring';
         return calculateScores(state);
    }

    return state;
};

export const handleReadyToPlay = (state: GameState, userId: string): GameState => {
    if (state.phase !== 'initial_look') throw new Error("Not in initial_look phase");
    
    const player = state.players[userId];
    if (!player) throw new Error("Player not found");
    
    player.isReady = true;
    state.lastAction = `${player.name} is ready`;

    // Check if all players are ready
    const allReady = state.playerOrder.every(pid => state.players[pid].isReady);
    
    if (allReady) {
        state.phase = 'playing';
        state.turnPhase = 'draw';
        state.lastAction = "All players ready! Game started.";
    }
    
    return state;
};

export const processMove = (state: GameState, action: GameAction, userId: string): { state: GameState, result?: any } => {
    switch (action.type) {
        case 'START_GAME':
             throw new Error("Use start-game function");
        case 'READY_TO_PLAY':
             return { state: handleReadyToPlay(state, userId) };
        case 'DRAW_FROM_DECK':
             return { state: drawFromDeck(state, userId) };
        case 'DRAW_FROM_DISCARD':
             return { state: drawFromDiscard(state, userId) };
        case 'DISCARD_DRAWN':
             return { state: discardDrawnCard(state, userId) };
        case 'SWAP_WITH_OWN':
             return { state: swapWithOwn(state, userId, action.cardIndex) };
        case 'CALL_KABOO':
             return { state: callKaboo(state, userId) };
        case 'SNAP':
             return { state: snapCard(state, userId, action.cardIndex) };
        
        // Effects
        case 'PEEK_OWN':
        case 'SPY_OPPONENT':
        case 'SWAP_ANY':
             return resolveEffect(state, userId, action);
             
        default:
             throw new Error("Invalid action type");
    }
};

export const sanitizeState = (state: GameState, viewingPlayerId: string): GameState => {
    if (!state) return state;
    const safeState = JSON.parse(JSON.stringify(state)); 
    
    // Mask Deck (keep count)
    if (safeState.deck && Array.isArray(safeState.deck)) {
        safeState.deck = safeState.deck.map((c: Card) => ({ ...c, value: 0, suit: 'hearts', rank: 'A', faceUp: false })); 
    }
    
    // Mask Players Cards
    if (safeState.players) {
        for (const pid in safeState.players) {
            const player = safeState.players[pid];
            if (player && player.cards && Array.isArray(player.cards)) {
                player.cards = player.cards.map((card: Card, index: number) => {
                    // Special Peek Rule: Allow peeking at first 2 cards during peeking phase
                    if (state.phase === 'initial_look' && pid === viewingPlayerId && (index === 0 || index === 1)) {
                        return card;
                    }

                    if (card.faceUp) return card; 
                    return { ...card, value: 0, suit: 'hearts', rank: 'A', faceUp: false };
                });
            }
        }
    }
    
    // Mask Drawn Card
    if (safeState.drawnCard) {
        if (safeState.drawnCard.source === 'deck') {
             if (viewingPlayerId !== safeState.currentTurnUserId) {
                 safeState.drawnCard = { ...safeState.drawnCard, value: 0, suit: 'hearts', rank: 'A', faceUp: false };
             }
        }
    }
    
    return safeState;
};
