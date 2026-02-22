
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { initializeGame, processMove, sanitizeState } from "./game-rules.ts";
import { GameState, GameAction } from "./types.ts";

Deno.test("Full Game Simulation", () => {
    const players = ["user1", "user2", "user3"];
    const roomCode = "TEST";

    let state = initializeGame(players, roomCode, {});
    assertEquals(state.phase, "initial_look");
    assertEquals(state.playerOrder.length, 3);

    const order = state.playerOrder;
    console.log("Player Order:", order);

    const u1 = order[0];
    const u2 = order[1];
    const u3 = order[2];

    state = processMove(state, { type: "READY_TO_PLAY" }, u1).state;
    state = processMove(state, { type: "READY_TO_PLAY" }, u2).state;
    state = processMove(state, { type: "READY_TO_PLAY" }, u3).state;
    assertEquals(state.phase, "playing");
    assertEquals(state.currentTurnUserId, u1);

    const sanitizedForU1 = sanitizeState(state, u1);
    assertEquals(sanitizedForU1.players[u2].cards[0].value, 0);

    const forceSafeTopCard = (id: string) => {
        state.deck[0] = {
            id,
            suit: "diamonds",
            rank: "3",
            value: 3,
            faceUp: false,
            source: "deck",
        };
    };

    for (const pid of state.playerOrder) {
        assertEquals(state.currentTurnUserId, pid);

        forceSafeTopCard(`pre-kaboo-${pid}`);
        let result = processMove(state, { type: "DRAW_FROM_DECK" }, pid);
        state = result.state;
        assertEquals(state.turnPhase, "action");

        result = processMove(state, { type: "DISCARD_DRAWN" }, pid);
        state = result.state;
        assertEquals(state.turnPhase, "draw");
    }

    const kabooCaller = state.currentTurnUserId as string;
    console.log(`\n--- ${kabooCaller} Calls Kaboo ---`);
    let kabooResult = processMove(state, { type: "CALL_KABOO" }, kabooCaller);
    state = kabooResult.state;

    assertEquals(state.kabooCallerId, kabooCaller);
    assertEquals(typeof state.turnsLeftAfterKaboo, "number");

    let safety = 0;
    while (state.phase !== "scoring" && safety < 20) {
        const current = state.currentTurnUserId as string;
        forceSafeTopCard(`post-kaboo-${safety}-${current}`);

        let result = processMove(state, { type: "DRAW_FROM_DECK" }, current);
        state = result.state;

        result = processMove(state, { type: "DISCARD_DRAWN" }, current);
        state = result.state;

        safety++;
    }

    assertEquals(state.phase, "scoring");
});
