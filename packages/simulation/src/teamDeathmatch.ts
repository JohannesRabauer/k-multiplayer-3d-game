import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

import type { Team } from "./index.js";

export type MatchPhase =
  "waiting_for_players" | "countdown" | "in_progress" | "ended" | "resetting";

export interface TeamDeathmatchState {
  readonly blueScore: number;
  readonly phase: MatchPhase;
  readonly redScore: number;
  readonly remainingMs: number;
  readonly winningTeam: Team | null;
}

export class TeamDeathmatch {
  readonly #players = new Map<string, Team>();
  #blueScore = 0;
  #deadlineMs: number | undefined;
  #phase: MatchPhase = "waiting_for_players";
  #redScore = 0;
  #winningTeam: Team | null = null;

  addPlayer(playerId: string, nowMs: number): Team {
    const existingTeam = this.#players.get(playerId);
    if (existingTeam !== undefined) {
      return existingTeam;
    }
    if (this.#players.size >= DEFAULT_GAME_CONFIG.match.initialMaxPlayers) {
      throw new Error("Match is full.");
    }

    const bluePlayers = this.#countPlayers("blue");
    const redPlayers = this.#countPlayers("red");
    const team: Team = bluePlayers <= redPlayers ? "blue" : "red";
    this.#players.set(playerId, team);
    this.#startCountdownWhenReady(nowMs);
    return team;
  }

  removePlayer(playerId: string): void {
    this.#players.delete(playerId);
    if (this.#phase === "countdown" && !this.#hasEnoughPlayers()) {
      this.#phase = "waiting_for_players";
      this.#deadlineMs = undefined;
    }
    if (this.#players.size === 0) {
      this.#reset();
    }
  }

  update(nowMs: number): void {
    if (this.#deadlineMs === undefined || nowMs < this.#deadlineMs) {
      return;
    }

    if (this.#phase === "countdown") {
      if (!this.#hasEnoughPlayers()) {
        this.#phase = "waiting_for_players";
        this.#deadlineMs = undefined;
        return;
      }
      this.#phase = "in_progress";
      this.#deadlineMs = nowMs + DEFAULT_GAME_CONFIG.match.durationMs;
      return;
    }

    if (this.#phase === "in_progress") {
      this.#endMatch(nowMs);
      return;
    }

    if (this.#phase === "ended") {
      this.#phase = "resetting";
      this.#deadlineMs = nowMs;
      return;
    }

    if (this.#phase === "resetting") {
      this.#reset();
      this.#startCountdownWhenReady(nowMs);
    }
  }

  recordElimination(
    attackerId: string,
    targetId: string,
    nowMs: number
  ): boolean {
    if (this.#phase !== "in_progress" || attackerId === targetId) {
      return false;
    }

    const attackerTeam = this.#players.get(attackerId);
    const targetTeam = this.#players.get(targetId);
    if (
      attackerTeam === undefined ||
      targetTeam === undefined ||
      attackerTeam === targetTeam
    ) {
      return false;
    }

    if (attackerTeam === "blue") {
      this.#blueScore += 1;
    } else {
      this.#redScore += 1;
    }

    if (
      this.#blueScore >= DEFAULT_GAME_CONFIG.match.scoreLimit ||
      this.#redScore >= DEFAULT_GAME_CONFIG.match.scoreLimit
    ) {
      this.#endMatch(nowMs);
    }
    return true;
  }

  getPlayerTeam(playerId: string): Team | undefined {
    return this.#players.get(playerId);
  }

  getState(nowMs: number): TeamDeathmatchState {
    return {
      blueScore: this.#blueScore,
      phase: this.#phase,
      redScore: this.#redScore,
      remainingMs:
        this.#deadlineMs === undefined
          ? 0
          : Math.max(0, this.#deadlineMs - nowMs),
      winningTeam: this.#winningTeam
    };
  }

  #countPlayers(team: Team): number {
    let count = 0;
    for (const playerTeam of this.#players.values()) {
      if (playerTeam === team) {
        count += 1;
      }
    }
    return count;
  }

  #endMatch(nowMs: number): void {
    this.#phase = "ended";
    this.#winningTeam =
      this.#blueScore === this.#redScore
        ? null
        : this.#blueScore > this.#redScore
          ? "blue"
          : "red";
    this.#deadlineMs = nowMs + DEFAULT_GAME_CONFIG.match.resultDurationMs;
  }

  #hasEnoughPlayers(): boolean {
    return (
      this.#players.size >= DEFAULT_GAME_CONFIG.match.minimumPlayers &&
      this.#countPlayers("blue") > 0 &&
      this.#countPlayers("red") > 0
    );
  }

  #reset(): void {
    this.#blueScore = 0;
    this.#deadlineMs = undefined;
    this.#phase = "waiting_for_players";
    this.#redScore = 0;
    this.#winningTeam = null;
  }

  #startCountdownWhenReady(nowMs: number): void {
    if (this.#phase !== "waiting_for_players" || !this.#hasEnoughPlayers()) {
      return;
    }
    this.#phase = "countdown";
    this.#deadlineMs = nowMs + DEFAULT_GAME_CONFIG.match.countdownMs;
  }
}
