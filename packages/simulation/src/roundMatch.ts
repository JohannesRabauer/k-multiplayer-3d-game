import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

import type { Team } from "./index.js";

export type RoundPhase =
  "warmup" | "in_progress" | "round_ended" | "intermission" | "match_ended";

export type RoundOutcome = Team | "draw";

export interface RoundMatchState {
  readonly blueRoundWins: number;
  readonly lastRoundWinner: RoundOutcome | null;
  readonly matchWinner: Team | null;
  readonly phase: RoundPhase;
  readonly redRoundWins: number;
  readonly remainingMs: number;
  readonly roundNumber: number;
}

export interface RoundMatchOptions {
  readonly intermissionMs?: number;
  readonly resultDurationMs?: number;
  readonly roundDurationMs?: number;
  readonly roundsToWin?: number;
  readonly warmupMs?: number;
}

/**
 * Round-based match flow. Combatants never respawn inside a round, so a losing
 * side cannot be farmed at its spawn point; every round starts from a clean
 * reset with a frozen warmup.
 */
export class RoundMatch {
  readonly #intermissionMs: number;
  readonly #resultDurationMs: number;
  readonly #roundDurationMs: number;
  readonly #roundsToWin: number;
  readonly #warmupMs: number;
  #blueRoundWins = 0;
  #deadlineMs: number;
  #lastRoundWinner: RoundOutcome | null = null;
  #matchWinner: Team | null = null;
  #phase: RoundPhase = "warmup";
  #pendingRoundReset = true;
  #redRoundWins = 0;
  #roundNumber = 1;

  constructor(nowMs: number, options: RoundMatchOptions = {}) {
    const defaults = DEFAULT_GAME_CONFIG.rounds;
    this.#roundsToWin = options.roundsToWin ?? defaults.roundsToWin;
    this.#roundDurationMs = options.roundDurationMs ?? defaults.roundDurationMs;
    this.#warmupMs = options.warmupMs ?? defaults.warmupMs;
    this.#intermissionMs = options.intermissionMs ?? defaults.intermissionMs;
    this.#resultDurationMs =
      options.resultDurationMs ?? defaults.resultDurationMs;

    for (const value of [
      this.#roundsToWin,
      this.#roundDurationMs,
      this.#warmupMs,
      this.#intermissionMs,
      this.#resultDurationMs
    ]) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("Round match timings must be positive.");
      }
    }

    this.#deadlineMs = nowMs + this.#warmupMs;
  }

  /** True only while combatants may move, shoot, and take damage. */
  isLive(nowMs: number): boolean {
    this.update(nowMs);
    return this.#phase === "in_progress";
  }

  /**
   * Returns true once per round when the caller should teleport every
   * combatant back to its spawn and restore full health.
   */
  consumeRoundReset(): boolean {
    if (!this.#pendingRoundReset) {
      return false;
    }
    this.#pendingRoundReset = false;
    return true;
  }

  /** Ends the current round in favour of `winner`. */
  endRound(winner: RoundOutcome, nowMs: number): void {
    if (this.#phase !== "in_progress") {
      return;
    }
    this.#lastRoundWinner = winner;
    if (winner === "blue") {
      this.#blueRoundWins += 1;
    } else if (winner === "red") {
      this.#redRoundWins += 1;
    }

    if (this.#blueRoundWins >= this.#roundsToWin) {
      this.#matchWinner = "blue";
    } else if (this.#redRoundWins >= this.#roundsToWin) {
      this.#matchWinner = "red";
    }

    this.#phase = this.#matchWinner === null ? "round_ended" : "match_ended";
    this.#deadlineMs =
      nowMs +
      (this.#matchWinner === null
        ? this.#intermissionMs
        : this.#resultDurationMs);
  }

  update(nowMs: number): void {
    if (nowMs < this.#deadlineMs) {
      return;
    }

    if (this.#phase === "warmup" || this.#phase === "intermission") {
      this.#phase = "in_progress";
      this.#deadlineMs = nowMs + this.#roundDurationMs;
      return;
    }

    if (this.#phase === "in_progress") {
      this.endRound("draw", nowMs);
      return;
    }

    if (this.#phase === "round_ended") {
      this.#roundNumber += 1;
      this.#pendingRoundReset = true;
      this.#phase = "intermission";
      this.#deadlineMs = nowMs + this.#warmupMs;
      return;
    }

    this.#blueRoundWins = 0;
    this.#redRoundWins = 0;
    this.#roundNumber = 1;
    this.#lastRoundWinner = null;
    this.#matchWinner = null;
    this.#pendingRoundReset = true;
    this.#phase = "warmup";
    this.#deadlineMs = nowMs + this.#warmupMs;
  }

  getState(nowMs: number): RoundMatchState {
    return {
      blueRoundWins: this.#blueRoundWins,
      lastRoundWinner: this.#lastRoundWinner,
      matchWinner: this.#matchWinner,
      phase: this.#phase,
      redRoundWins: this.#redRoundWins,
      remainingMs: Math.max(0, this.#deadlineMs - nowMs),
      roundNumber: this.#roundNumber
    };
  }

  getRoundsToWin(): number {
    return this.#roundsToWin;
  }
}
