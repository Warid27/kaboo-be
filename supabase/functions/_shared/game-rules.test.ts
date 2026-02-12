// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createDeck, initializeGame, drawFromDeck, discardDrawnCard, swapWithOwn, callKaboo, getCardValue, resolveEffect, snapCard, sanitizeState } from "./game-rules.ts";

const mockSettings = {
  turnTimer: '30',
  mattsPairsRule: false,
  useEffectCards: true,
  numPlayers: 2,
  botDifficulty: 'medium',
  targetScore: '100'
};

Deno.test("Deck Creation", () => {
  const deck = createDeck();
  assertEquals(deck.length, 54); // 52 + 2 Jokers
});

Deno.test("Game Initialization", () => {
  const players = ["p1", "p2"];
  const game = initializeGame(players, "TEST", mockSettings);
  
  assertEquals(game.deck.length, 54 - 8 - 1); // 54 - (4*2) - 1 discard
  assertEquals(game.discardPile.length, 1);
  assertEquals(game.players["p1"].cards.length, 4);
});

Deno.test("Turn Flow - Draw and Discard", () => {
  const players = ["p1", "p2"];
  let game = initializeGame(players, "TEST", mockSettings);
  
  // Force p1 turn
  game.currentTurnUserId = "p1";
  
  game = drawFromDeck(game, "p1");
  assertEquals(game.turnPhase, "action");
  
  // Force non-power card to ensure turn ends
  game.drawnCard!.rank = '3';
  
  game = discardDrawnCard(game, "p1");
  assertEquals(game.turnPhase, "draw");
  assertEquals(game.currentTurnUserId, "p2");
});

Deno.test("Turn Flow - Swap", () => {
  const players = ["p1", "p2"];
  let game = initializeGame(players, "TEST", mockSettings);
  game.currentTurnUserId = "p1";
  
  game = drawFromDeck(game, "p1");
  const drawnCard = game.drawnCard!;
  
  const oldHandCard = game.players["p1"].cards[0];
  
  game = swapWithOwn(game, "p1", 0);
  
  assertEquals(game.players["p1"].cards[0].id, drawnCard.id);
  assertEquals(game.discardPile[game.discardPile.length-1].id, oldHandCard.id);
  assertEquals(game.currentTurnUserId, "p2");
});

Deno.test("Kaboo Logic", () => {
  const players = ["p1", "p2", "p3"];
  let game = initializeGame(players, "KABOO", { ...mockSettings, numPlayers: 3 });
  game.currentTurnUserId = "p1";
  game.playerOrder = ["p1", "p2", "p3"];
  
  // p1 calls Kaboo
  game = callKaboo(game, "p1");
  
  assertEquals(game.kabooCallerId, "p1");
  // Logic: 3 players. P1 calls. P2 (1), P3 (2).
  // Initial turnsLeft = 3.
  // endTurn -> decrements to 2.
  // So we expect 2.
  assertEquals(game.turnsLeftAfterKaboo, 2); 
  assertEquals(game.currentTurnUserId, "p2");
  
  // p2 plays
  game = drawFromDeck(game, "p2");
  game.drawnCard!.rank = '3'; // Force non-power
  game = discardDrawnCard(game, "p2");
  assertEquals(game.turnsLeftAfterKaboo, 1);
  assertEquals(game.currentTurnUserId, "p3");
  
  // p3 plays
  game = drawFromDeck(game, "p3");
  game.drawnCard!.rank = '3'; // Force non-power
  game = discardDrawnCard(game, "p3");
  assertEquals(game.turnsLeftAfterKaboo, 0); // Finished
  assertEquals(game.phase, "scoring");
});

Deno.test("Card Values", () => {
    assertEquals(getCardValue("K", "hearts"), 0);
    assertEquals(getCardValue("K", "diamonds"), 0);
    assertEquals(getCardValue("K", "spades"), 13);
    assertEquals(getCardValue("K", "clubs"), 13);
    
    assertEquals(getCardValue("Q", "hearts"), 0); // Red Queen
    assertEquals(getCardValue("J", "diamonds"), 0); // Red Jack
    
    assertEquals(getCardValue("Q", "spades"), 12); // Black Queen
    assertEquals(getCardValue("J", "clubs"), 11); // Black Jack
});

Deno.test("Card Effect - Peek Own (7)", () => {
    const players = ["p1", "p2"];
    let game = initializeGame(players, "TEST", mockSettings);
    game.currentTurnUserId = "p1";
    
    game = drawFromDeck(game, "p1");
    // Force draw a 7
    game.drawnCard!.rank = '7';
    
    game = discardDrawnCard(game, "p1");
    
    assertEquals(game.turnPhase, "effect");
    assertEquals(game.pendingEffect?.type, "PEEK_OWN");
    
    // Resolve Effect
    const result = resolveEffect(game, "p1", "p1", 0);
    game = result.state;
    
    assertEquals(game.turnPhase, "draw"); // Turn ends after effect
    assertEquals(game.currentTurnUserId, "p2");
});

Deno.test("Snap Logic", () => {
    const players = ["p1", "p2"];
    let game = initializeGame(players, "TEST", mockSettings);
    
    // Setup discard pile with '5'
    game.discardPile = [{id: 'd1', rank: '5', suit: 'hearts', value: 5, faceUp: true}];
    
    // Give p1 a '5'
    game.players["p1"].cards[0] = {id: 'c1', rank: '5', suit: 'spades', value: 5, faceUp: false};
    
    const initialHandSize = game.players["p1"].cards.length;
    
    game = snapCard(game, "p1", 0);
    
    assertEquals(game.players["p1"].cards.length, initialHandSize - 1);
    assertEquals(game.discardPile.length, 2);
    assertEquals(game.discardPile[game.discardPile.length-1].rank, '5');
});

Deno.test("State Sanitization - Masking Drawn Card", () => {
    const players = ["p1", "p2"];
    const game = initializeGame(players, "TEST", mockSettings);
    game.currentTurnUserId = "p1";
    
    // p1 draws from deck
    // deno-lint-ignore no-explicit-any
    const drawnCard: any = { id: 'd1', rank: '7', suit: 'spades', value: 7, faceUp: true, source: 'deck' };
    game.drawnCard = drawnCard;
    
    // View as p1 (should see card)
    const p1State = sanitizeState(game, "p1");
    assertEquals(p1State.drawnCard?.rank, '7');
    assertEquals(p1State.drawnCard?.faceUp, true);
    
    // View as p2 (should be masked)
    const p2State = sanitizeState(game, "p2");
    assertEquals(p2State.drawnCard?.rank, 'A');
    assertEquals(p2State.drawnCard?.suit, 'hearts');
    assertEquals(p2State.drawnCard?.faceUp, false);
});
