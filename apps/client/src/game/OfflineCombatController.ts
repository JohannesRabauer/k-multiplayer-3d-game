import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import {
  applyDamage,
  createPlayerCombatState,
  TeamDeathmatch,
  tryRespawn
} from "@scooter-shooter/simulation";

interface CombatHud {
  readonly blueScore: HTMLElement;
  readonly feedback: HTMLElement;
  readonly matchState: HTMLElement;
  readonly redScore: HTMLElement;
  readonly respawn: HTMLElement;
  readonly timer: HTMLTimeElement;
}

export class OfflineCombatController {
  readonly #attacker;
  readonly #hud: CombatHud;
  readonly #match = new TeamDeathmatch();
  readonly #target;
  readonly #targetMesh: AbstractMesh;
  #feedbackExpiresAtMs = 0;

  constructor(targetMesh: AbstractMesh, hud: CombatHud, nowMs: number) {
    this.#targetMesh = targetMesh;
    this.#hud = hud;
    this.#match.addPlayer("local-player", nowMs);
    this.#match.addPlayer("target-dummy", nowMs);
    this.#attacker = createPlayerCombatState("local-player", "blue", nowMs);
    this.#target = createPlayerCombatState("target-dummy", "red", nowMs);
    this.update(nowMs);
  }

  registerTargetHit(nowMs: number): void {
    if (this.#match.getState(nowMs).phase !== "in_progress") {
      this.#showFeedback("WAIT FOR START", "blocked", nowMs, 700);
      return;
    }

    const result = applyDamage(
      this.#attacker,
      this.#target,
      DEFAULT_GAME_CONFIG.pistol.damage,
      nowMs
    );
    if (!result.applied) {
      return;
    }

    if (!result.eliminated) {
      this.#showFeedback("HIT", "hit", nowMs, 180);
      return;
    }

    this.#match.recordElimination("local-player", "target-dummy", nowMs);
    this.#targetMesh.setEnabled(false);
    this.#showFeedback("ELIMINATION", "elimination", nowMs, 900);
  }

  update(nowMs: number): void {
    this.#match.update(nowMs);

    if (tryRespawn(this.#target, nowMs)) {
      this.#targetMesh.setEnabled(true);
      this.#showFeedback("TARGET RESPAWNED", "respawn", nowMs, 700);
    }

    const state = this.#match.getState(nowMs);
    this.#hud.blueScore.textContent = String(state.blueScore);
    this.#hud.redScore.textContent = String(state.redScore);
    this.#renderMatchState(state.phase, state.remainingMs, state.winningTeam);
    this.#renderRespawn(nowMs);

    if (this.#feedbackExpiresAtMs !== 0 && nowMs >= this.#feedbackExpiresAtMs) {
      this.#hud.feedback.textContent = "";
      delete this.#hud.feedback.dataset.kind;
      this.#feedbackExpiresAtMs = 0;
    }
  }

  #renderMatchState(
    phase: ReturnType<TeamDeathmatch["getState"]>["phase"],
    remainingMs: number,
    winningTeam: ReturnType<TeamDeathmatch["getState"]>["winningTeam"]
  ): void {
    this.#hud.matchState.dataset.phase = phase;
    if (phase === "waiting_for_players") {
      this.#hud.matchState.textContent = "WAITING FOR PLAYERS";
    } else if (phase === "countdown") {
      this.#hud.matchState.textContent = `MATCH STARTS IN ${String(Math.ceil(remainingMs / 1_000))}`;
    } else if (phase === "ended") {
      this.#hud.matchState.textContent =
        winningTeam === null
          ? "DRAW"
          : `${winningTeam.toUpperCase()} TEAM WINS`;
    } else if (phase === "resetting") {
      this.#hud.matchState.textContent = "RESETTING MATCH";
    } else {
      this.#hud.matchState.textContent = "";
    }

    const remainingSeconds = Math.ceil(remainingMs / 1_000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    this.#hud.timer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    this.#hud.timer.dateTime = `PT${String(remainingSeconds)}S`;
  }

  #renderRespawn(nowMs: number): void {
    if (this.#target.respawnAtMs === undefined) {
      this.#hud.respawn.hidden = true;
      return;
    }

    this.#hud.respawn.hidden = false;
    this.#hud.respawn.textContent = `TARGET RESPAWNS IN ${String(Math.ceil((this.#target.respawnAtMs - nowMs) / 1_000))}`;
  }

  #showFeedback(
    message: string,
    kind: string,
    nowMs: number,
    durationMs: number
  ): void {
    this.#hud.feedback.textContent = message;
    this.#hud.feedback.dataset.kind = kind;
    this.#feedbackExpiresAtMs = nowMs + durationMs;
  }
}
