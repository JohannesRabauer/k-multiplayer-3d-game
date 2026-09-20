import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import {
  applyDamage,
  createPlayerCombatState,
  RoundMatch,
  type PlayerCombatState,
  type RoundMatchState
} from "@scooter-shooter/simulation";

interface CombatHud {
  readonly blueScore: HTMLElement;
  readonly feedback: HTMLElement;
  readonly health: HTMLElement;
  readonly matchState: HTMLElement;
  readonly redScore: HTMLElement;
  readonly respawn: HTMLElement;
  readonly timer: HTMLTimeElement;
}

export interface OfflineBotCombatant {
  readonly id: string;
  readonly mesh: AbstractMesh;
  readonly spawnPosition: Vector3;
}

interface BotState extends OfflineBotCombatant {
  combat: PlayerCombatState;
}

export class OfflineCombatController {
  readonly #bots = new Map<string, BotState>();
  readonly #hud: CombatHud;
  readonly #match: RoundMatch;
  readonly #playerMesh: AbstractMesh;
  readonly #playerSpawnPosition: Vector3;
  #feedbackExpiresAtMs = 0;
  #player: PlayerCombatState;

  constructor(
    playerMesh: AbstractMesh,
    playerSpawnPosition: Vector3,
    bots: readonly OfflineBotCombatant[],
    hud: CombatHud,
    nowMs: number
  ) {
    this.#playerMesh = playerMesh;
    this.#playerSpawnPosition = playerSpawnPosition.clone();
    this.#hud = hud;
    this.#match = new RoundMatch(nowMs);
    this.#player = createPlayerCombatState("local-player", "blue", nowMs);
    this.#hud.health.textContent = String(this.#player.health);

    for (const bot of bots) {
      this.#bots.set(bot.id, {
        ...bot,
        combat: createPlayerCombatState(bot.id, "red", nowMs)
      });
    }
    this.update(nowMs);
  }

  /** True only while the current round is live and damage may be dealt. */
  isRoundLive(nowMs: number): boolean {
    return this.#match.isLive(nowMs);
  }

  registerTargetHit(targetId: string, nowMs: number): void {
    if (!this.#match.isLive(nowMs) || !this.#player.isAlive) {
      this.#showFeedback("HOLD FIRE", "blocked", nowMs, 600);
      return;
    }

    const bot = this.#bots.get(targetId);
    if (bot === undefined) {
      return;
    }
    const result = applyDamage(
      this.#player,
      bot.combat,
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

    bot.mesh.setEnabled(false);
    this.#showFeedback("ELIMINATION", "elimination", nowMs, 900);
    if (this.#countLivingBots() === 0) {
      this.#match.endRound("blue", nowMs);
      this.#showFeedback("ROUND WON", "elimination", nowMs, 1_500);
    }
  }

  registerBotHit(botId: string, nowMs: number, damage: number): void {
    if (!this.#match.isLive(nowMs)) {
      return;
    }
    const bot = this.#bots.get(botId);
    if (bot?.combat.isAlive !== true) {
      return;
    }

    const result = applyDamage(bot.combat, this.#player, damage, nowMs);
    if (!result.applied) {
      return;
    }
    this.#hud.health.textContent = String(result.remainingHealth);
    if (!result.eliminated) {
      return;
    }

    this.#playerMesh.setEnabled(false);
    this.#showFeedback("ROUND LOST", "blocked", nowMs, 1_500);
    this.#match.endRound("red", nowMs);
  }

  isPlayerAlive(): boolean {
    return this.#player.isAlive;
  }

  update(nowMs: number): void {
    this.#match.update(nowMs);
    if (this.#match.consumeRoundReset()) {
      this.#resetCombatants(nowMs);
    }

    const state = this.#match.getState(nowMs);
    this.#hud.blueScore.textContent = String(state.blueRoundWins);
    this.#hud.redScore.textContent = String(state.redRoundWins);
    this.#renderMatchState(state);
    this.#renderRoundNotice(state);

    if (this.#feedbackExpiresAtMs !== 0 && nowMs >= this.#feedbackExpiresAtMs) {
      this.#hud.feedback.textContent = "";
      delete this.#hud.feedback.dataset.kind;
      this.#feedbackExpiresAtMs = 0;
    }
  }

  #resetCombatants(nowMs: number): void {
    this.#player = createPlayerCombatState("local-player", "blue", nowMs);
    this.#playerMesh.position.copyFrom(this.#playerSpawnPosition);
    this.#playerMesh.setEnabled(true);
    this.#hud.health.textContent = String(this.#player.health);

    for (const bot of this.#bots.values()) {
      bot.combat = createPlayerCombatState(bot.id, "red", nowMs);
      bot.mesh.position.copyFrom(bot.spawnPosition);
      bot.mesh.setEnabled(true);
    }
  }

  #countLivingBots(): number {
    let count = 0;
    for (const bot of this.#bots.values()) {
      if (bot.combat.isAlive) {
        count += 1;
      }
    }
    return count;
  }

  #renderMatchState(state: RoundMatchState): void {
    const { matchState } = this.#hud;
    matchState.dataset.phase = state.phase;
    matchState.dataset.round = String(state.roundNumber);

    if (state.phase === "warmup" || state.phase === "intermission") {
      matchState.textContent = `ROUND ${String(state.roundNumber)} IN ${String(
        Math.ceil(state.remainingMs / 1_000)
      )}`;
    } else if (state.phase === "round_ended") {
      matchState.textContent =
        state.lastRoundWinner === "draw"
          ? "ROUND DRAW"
          : state.lastRoundWinner === "blue"
            ? "ROUND WON"
            : "ROUND LOST";
    } else if (state.phase === "match_ended") {
      matchState.textContent =
        state.matchWinner === "blue" ? "MATCH WON" : "MATCH LOST";
    } else {
      matchState.textContent = "";
    }

    const remainingSeconds = Math.ceil(state.remainingMs / 1_000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    this.#hud.timer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    this.#hud.timer.dateTime = `PT${String(remainingSeconds)}S`;
  }

  #renderRoundNotice(state: RoundMatchState): void {
    // There are no mid-round respawns, so this slot explains why the player is
    // waiting instead of counting down to a respawn.
    if (state.phase === "in_progress") {
      this.#hud.respawn.hidden = this.#player.isAlive;
      this.#hud.respawn.textContent = "ELIMINATED - WAITING FOR NEXT ROUND";
      return;
    }

    this.#hud.respawn.hidden = false;
    this.#hud.respawn.textContent = `ROUND ${String(state.roundNumber)} - FIRST TO ${String(
      this.#match.getRoundsToWin()
    )}`;
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
