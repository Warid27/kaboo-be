// deno-lint-ignore-file prefer-const no-explicit-any
import { Card, GameState, PlayerState, Suit, Rank, GameAction } from './types.ts';

// --- Card Values & Generation ---

export const getCardValue = (rank: Rank, suit: Suit): number => {
  if (rank === 'JOKER') return -1;
  
  // Red Kings (Hearts/Diamonds) = 0
  // Black Kings (Spades/Clubs) = 13
  if (rank === 'K') {
      if (suit === 'HEARTS' || suit === 'DIAMONDS') return 0;
      return 13;
  }

  // Red Jack/Queen = 0? 
  // Markdown says: "Red King, Jack, Queen (Hearts/Diamonds) | 0 | Best card"
  if ((rank === 'J' || rank === 'Q') && (suit === 'HEARTS' || suit === 'DIAMONDS')) {
      return 0;
  }
  
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  
  return parseInt(rank, 10);
};

export const createDeck = (): Card[] => {
  const suits: Suit[] = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'];
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
        isFaceUp: false,
      });
    }
  }
  
  // Add 2 Jokers
  deck.push({ id: crypto.randomUUID(), suit: 'JOKER', rank: 'JOKER', value: -1, isFaceUp: false });
  deck.push({ id: crypto.randomUUID(), suit: 'JOKER', rank: 'JOKER', value: -1, isFaceUp: false });
  
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

export const initializeGame = (playerIds: string[], roomCode: string): GameState => {
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
    firstDiscard.isFaceUp = true;
  }
  const discardPile = firstDiscard ? [firstDiscard] : [];

  const playerOrder = shuffle([...playerIds]); // Randomize start order

    return {
      roomCode,
      phase: 'initial_look', // Start in initial_look phase
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
      // Reshuffle discard into deck if empty (keeping top card)
      if (state.discardPile.length > 1) {
          const topCard = state.discardPile.pop()!;
          const newDeck = shuffle(state.discardPile);
          // Flip cards down
          newDeck.forEach(c => c.isFaceUp = false);
          state.deck = newDeck;
          state.discardPile = [topCard];
      } else {
          throw new Error("Deck empty and cannot reshuffle");
      }
  }
  
  const card = state.deck.shift();
  if (!card) throw new Error("Deck is empty");
  
  card.isFaceUp = true; // Player looks at it (private in reality, but logic-wise "held")
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
  card.isFaceUp = true;
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

    state.drawnCard.isFaceUp = true;
    state.discardPile.push(state.drawnCard);
    const playedCard = state.drawnCard;
    state.drawnCard = null;
    
    // Check Powers
    const rank = playedCard.rank;
    const suit = playedCard.suit;
    let effectType: 'PEEK_OWN' | 'PEEK_OTHER' | 'SWAP_EITHER' | 'LOOK_AND_SWAP' | null = null;

    if (rank === '7' || rank === '8') effectType = 'PEEK_OWN';
    else if (rank === '9' || rank === '10') effectType = 'PEEK_OTHER';
    // Black J/Q allow Blind Swap
    else if ((rank === 'J' || rank === 'Q') && (suit === 'SPADES' || suit === 'CLUBS')) effectType = 'SWAP_EITHER'; 
    // Black K allows Look & Swap
    else if (rank === 'K' && (suit === 'SPADES' || suit === 'CLUBS')) effectType = 'LOOK_AND_SWAP'; 

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
    targetPlayerId: string, 
    targetCardIndex: number,
    ownCardIndex?: number // Required for Swap
): { state: GameState, result?: any } => {
    if (state.currentTurnUserId !== userId) throw new Error("Not your turn");
    if (state.turnPhase !== 'effect') throw new Error("Not in effect phase");
    if (!state.pendingEffect) throw new Error("No pending effect");

    const effect = state.pendingEffect.type;
    const targetPlayer = state.players[targetPlayerId];
    if (!targetPlayer) throw new Error("Target player not found");
    if (!targetPlayer.cards[targetCardIndex]) throw new Error("Target card invalid");

    let result = null;

    if (effect === 'PEEK_OWN') {
        if (targetPlayerId !== userId) throw new Error("Must peek own card");
        // Result is the card info. In a real server, we return this to the client only.
        // For state, we just mark it done.
        // Optionally, we could mark card as 'knownByOwner' in state if we tracked that.
        result = targetPlayer.cards[targetCardIndex];
        state.lastAction = `Peeked own card`;
    } 
    else if (effect === 'PEEK_OTHER') {
        if (targetPlayerId === userId) throw new Error("Must peek other player's card");
        result = targetPlayer.cards[targetCardIndex];
        state.lastAction = `Peeked ${targetPlayer.name}'s card`;
    }
    else if (effect === 'SWAP_EITHER') {
        // Blind Swap
        if (ownCardIndex === undefined) throw new Error("Own card index required for swap");
        if (targetPlayerId === userId) throw new Error("Swap with yourself? Use Swap Action.");
        
        const myself = state.players[userId];
        if (!myself.cards[ownCardIndex]) throw new Error("Invalid own card");
        
        // Swap
        const myCard = myself.cards[ownCardIndex];
        const theirCard = targetPlayer.cards[targetCardIndex];
        
        myself.cards[ownCardIndex] = theirCard;
        targetPlayer.cards[targetCardIndex] = myCard;
        
        state.lastAction = `Swapped card with ${targetPlayer.name}`;
    }
    else if (effect === 'LOOK_AND_SWAP') {
        // This is complex. Usually it's a 2-step process: Look, THEN decide to swap.
        // For MVP, let's treat it as "Peek Other" OR "Swap". 
        // If the user sends "ownCardIndex", it's a swap. If not, it's a peek?
        // Or we enforce "Peek first".
        // Let's implement it as Peek Other for now, or just Swap.
        // Let's do Swap for now (powerful).
         if (ownCardIndex !== undefined) {
             // Perform Swap
             const myself = state.players[userId];
             const myCard = myself.cards[ownCardIndex];
             const theirCard = targetPlayer.cards[targetCardIndex];
             myself.cards[ownCardIndex] = theirCard;
             targetPlayer.cards[targetCardIndex] = myCard;
             state.lastAction = `Swapped (King) with ${targetPlayer.name}`;
         } else {
             // Just Peek
             result = targetPlayer.cards[targetCardIndex];
             state.lastAction = `Peeked (King) ${targetPlayer.name}'s card`;
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
        card.isFaceUp = true;
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
             penaltyCard.isFaceUp = false; // or true?
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
    player.cards[cardIndex].isFaceUp = false; // Face down in hand
    
    oldCard.isFaceUp = true;
    state.discardPile.push(oldCard); // Discard the old one
    state.drawnCard = null;
    
    state.lastAction = `Swapped card`;
    return endTurn(state);
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
             return resolveEffect(state, userId, userId, action.cardIndex);
        case 'SPY_OPPONENT':
             return resolveEffect(state, userId, action.targetPlayerId, action.cardIndex);
        case 'SWAP_ANY':
             return resolveEffect(state, userId, action.targetPlayerId, action.cardIndex, action.ownCardIndex);
             
        default:
             throw new Error("Invalid action type");
    }
};

export const sanitizeState = (state: GameState, viewingPlayerId: string): GameState => {
    const safeState = JSON.parse(JSON.stringify(state)); 
    
    // Mask Deck (keep count)
    safeState.deck = safeState.deck.map((c: Card) => ({ ...c, value: 0, suit: 'hearts', rank: 'A', isFaceUp: false })); 
    
    // Mask Players Cards
    for (const pid in safeState.players) {
        const player = safeState.players[pid];
        player.cards = player.cards.map((card: Card, index: number) => {
            // Special Peek Rule: Allow peeking at first 2 cards during peeking phase
            if (state.phase === 'initial_look' && pid === viewingPlayerId && (index === 0 || index === 1)) {
                return card;
            }

            if (card.isFaceUp) return card; 
            return { ...card, value: 0, suit: 'hearts', rank: 'A', isFaceUp: false };
        });
    }
    
    // Mask Drawn Card
    if (safeState.drawnCard) {
        if (safeState.drawnCard.source === 'deck') {
             if (viewingPlayerId !== safeState.currentTurnUserId) {
                 safeState.drawnCard = { ...safeState.drawnCard, value: 0, suit: 'hearts', rank: 'A', isFaceUp: false };
             }
        }
    }
    
    return safeState;
};
