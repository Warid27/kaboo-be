
export type Suit = 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES' | 'JOKER';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'JOKER';

export interface Card {
  id: string; // Unique ID for tracking specific cards
  suit: Suit;
  rank: Rank;
  value: number; // Game value (e.g., King of Diamonds = 0, etc.)
  isFaceUp: boolean;
  source?: 'deck' | 'discard'; // Track source where it was drawn from
}

export interface PlayerState {
  id: string; // User ID
  name: string;
  isConnected: boolean;
  cards: Card[]; // The cards in front of the player
  score: number; // Total score from previous rounds
  kabooCalled: boolean;
}

export interface GameState {
  roomCode: string;
  phase: 'lobby' | 'dealing' | 'playing' | 'scoring' | 'finished';
  
  // Players map (key: userId)
  players: Record<string, PlayerState>;
  playerOrder: string[]; // Array of userIds
  
  // Table
  deck: Card[];
  discardPile: Card[];
  
  // Turn State
  currentTurnUserId: string | null;
  turnPhase: 'draw' | 'action' | 'discard' | 'effect'; // Sub-phases of a turn
  drawnCard: Card | null; // The card currently held by the active player (from deck)
  pendingEffect: {
      type: 'PEEK_OWN' | 'PEEK_OTHER' | 'SWAP_EITHER' | 'LOOK_AND_SWAP';
      sourceCardRank?: Rank;
  } | null;

  // Kaboo Mechanics
  kabooCallerId: string | null;
  turnsLeftAfterKaboo: number | null; // Counts down rounds after Kaboo is called
  
  lastAction: string | null; // Description of last move for UI
}

export type GameAction =
  | { type: 'START_GAME' }
  | { type: 'DRAW_FROM_DECK' }
  | { type: 'DRAW_FROM_DISCARD' }
  | { type: 'SWAP_WITH_OWN', cardIndex: number } // Swap drawn card with own card
  | { type: 'DISCARD_DRAWN' } // Discard the card just drawn from deck
  | { type: 'CALL_KABOO' }
  | { type: 'PEEK_OWN', cardIndex: number } // If ability allows
  | { type: 'SPY_OPPONENT', targetPlayerId: string, cardIndex: number } // If ability allows
  | { type: 'SWAP_ANY', targetPlayerId: string, cardIndex: number, ownCardIndex: number } // If ability allows
  | { type: 'SNAP', cardIndex: number }; // Tap/Snap action

export interface GameResult {
  winnerId: string;
  scores: Record<string, number>;
}
