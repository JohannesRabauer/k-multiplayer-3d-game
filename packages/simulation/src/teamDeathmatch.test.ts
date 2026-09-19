import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

import { TeamDeathmatch } from "./teamDeathmatch.js";

void describe("Team Deathmatch", () => {
  void it("balances teams and starts when both teams have a player", () => {
    const match = new TeamDeathmatch();

    assert.equal(match.addPlayer("one", 0), "blue");
    assert.equal(match.getState(0).phase, "waiting_for_players");
    assert.equal(match.addPlayer("two", 0), "red");
    assert.equal(match.getState(0).phase, "countdown");
  });

  void it("cancels the countdown if a team becomes empty", () => {
    const match = new TeamDeathmatch();
    match.addPlayer("one", 0);
    match.addPlayer("two", 0);

    match.removePlayer("two");

    assert.equal(match.getState(0).phase, "waiting_for_players");
  });

  void it("starts and ends a timed match", () => {
    const match = createStartedMatch();
    match.update(
      DEFAULT_GAME_CONFIG.match.countdownMs +
        DEFAULT_GAME_CONFIG.match.durationMs
    );

    assert.deepEqual(
      match.getState(
        DEFAULT_GAME_CONFIG.match.countdownMs +
          DEFAULT_GAME_CONFIG.match.durationMs
      ),
      {
        blueScore: 0,
        phase: "ended",
        redScore: 0,
        remainingMs: DEFAULT_GAME_CONFIG.match.resultDurationMs,
        winningTeam: null
      }
    );
  });

  void it("scores only valid opponent eliminations", () => {
    const match = createStartedMatch();
    const matchStart = DEFAULT_GAME_CONFIG.match.countdownMs;

    assert.equal(match.recordElimination("one", "one", matchStart), false);
    assert.equal(match.recordElimination("missing", "two", matchStart), false);
    assert.equal(match.recordElimination("one", "two", matchStart), true);
    assert.equal(match.getState(matchStart).blueScore, 1);
  });

  void it("ends immediately at the score limit", () => {
    const match = createStartedMatch();
    const matchStart = DEFAULT_GAME_CONFIG.match.countdownMs;

    for (
      let score = 0;
      score < DEFAULT_GAME_CONFIG.match.scoreLimit;
      score += 1
    ) {
      assert.equal(match.recordElimination("one", "two", matchStart), true);
    }

    const state = match.getState(matchStart);
    assert.equal(state.phase, "ended");
    assert.equal(state.winningTeam, "blue");
  });

  void it("resets safely after all players leave", () => {
    const match = createStartedMatch();
    match.removePlayer("one");
    match.removePlayer("two");

    assert.deepEqual(match.getState(0), {
      blueScore: 0,
      phase: "waiting_for_players",
      redScore: 0,
      remainingMs: 0,
      winningTeam: null
    });
  });
});

function createStartedMatch(): TeamDeathmatch {
  const match = new TeamDeathmatch();
  match.addPlayer("one", 0);
  match.addPlayer("two", 0);
  match.update(DEFAULT_GAME_CONFIG.match.countdownMs);
  return match;
}
