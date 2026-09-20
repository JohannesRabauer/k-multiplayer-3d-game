import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { RoundMatch } from "./roundMatch.js";

const options = {
  intermissionMs: 500,
  resultDurationMs: 700,
  roundDurationMs: 2_000,
  roundsToWin: 2,
  warmupMs: 1_000
};

void describe("Round match", () => {
  void it("freezes combat during the opening warmup", () => {
    const match = new RoundMatch(0, options);

    assert.equal(match.getState(0).phase, "warmup");
    assert.equal(match.isLive(500), false);
    assert.equal(match.isLive(1_000), true);
    assert.equal(match.getState(1_000).roundNumber, 1);
  });

  void it("requests a combatant reset before the first round", () => {
    const match = new RoundMatch(0, options);

    assert.equal(match.consumeRoundReset(), true);
    assert.equal(match.consumeRoundReset(), false);
  });

  void it("awards a round and runs an intermission before the next one", () => {
    const match = new RoundMatch(0, options);
    match.consumeRoundReset();
    match.update(1_000);

    match.endRound("blue", 1_200);
    assert.equal(match.getState(1_200).phase, "round_ended");
    assert.equal(match.getState(1_200).blueRoundWins, 1);
    assert.equal(match.getState(1_200).lastRoundWinner, "blue");

    match.update(1_700);
    const state = match.getState(1_700);
    assert.equal(state.phase, "intermission");
    assert.equal(state.roundNumber, 2);
    assert.equal(match.consumeRoundReset(), true);
    assert.equal(match.isLive(1_800), false);
    assert.equal(match.isLive(2_700), true);
  });

  void it("ends a stalled round as a draw without awarding wins", () => {
    const match = new RoundMatch(0, options);
    match.update(1_000);
    match.update(3_000);

    const state = match.getState(3_000);
    assert.equal(state.lastRoundWinner, "draw");
    assert.equal(state.blueRoundWins, 0);
    assert.equal(state.redRoundWins, 0);
  });

  void it("ends the match once a side reaches the required round wins", () => {
    const match = new RoundMatch(0, options);
    match.update(1_000);
    match.endRound("red", 1_100);
    match.update(1_600);
    match.update(2_600);
    match.endRound("red", 2_700);

    const state = match.getState(2_700);
    assert.equal(state.phase, "match_ended");
    assert.equal(state.matchWinner, "red");
    assert.equal(state.redRoundWins, 2);
  });

  void it("restarts a fresh match after the result screen", () => {
    const match = new RoundMatch(0, options);
    match.update(1_000);
    match.endRound("blue", 1_100);
    match.update(1_600);
    match.update(2_600);
    match.endRound("blue", 2_700);
    match.update(3_400);

    const state = match.getState(3_400);
    assert.equal(state.phase, "warmup");
    assert.equal(state.blueRoundWins, 0);
    assert.equal(state.roundNumber, 1);
    assert.equal(match.consumeRoundReset(), true);
  });

  void it("ignores round results outside a live round", () => {
    const match = new RoundMatch(0, options);

    match.endRound("blue", 100);
    assert.equal(match.getState(100).blueRoundWins, 0);
  });

  void it("rejects non-positive timings", () => {
    assert.throws(() => new RoundMatch(0, { roundDurationMs: 0 }), RangeError);
  });
});
