import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import {
  applyDamage,
  createPlayerCombatState,
  TeamDeathmatch,
  tryRespawn,
  type PlayerCombatState
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
  readonly combat: PlayerCombatState;
}

export class OfflineCombatController {
  readonly #bots = new Map<string, BotState>();
  readonly #hud: CombatHud;
  readonly #match: TeamDeathmatch;
  readonly #player: PlayerCombatState;
  readonly #playerMesh: AbstractMesh;
  readonly #playerSpawnPosition: Vector3;
  #feedbackExpiresAtMs = 0;

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
    this.#match = new TeamDeathmatch(bots.length + 1, 3_000);
    this.#match.addPlayer("local-player", nowMs, "blue");
    this.#player = createPlayerCombatState("local-player", "blue", nowMs);
    this.#hud.health.textContent = String(this.#player.health);

    for (const bot of bots) {
      this.#match.addPlayer(bot.id, nowMs, "red");
      this.#bots.set(bot.id, {
        ...bot,
        combat: createPlayerCombatState(bot.id, "red", nowMs)
      });
    }
    this.update(nowMs);
  }

  registerTargetHit(targetId: string, nowMs: number): void {
    if (
      !this.#player.isAlive ||
      this.#match.getState(nowMs).phase !== "in_progress"
    ) {
      this.#showFeedback("WAIT FOR START", "blocked", nowMs, 700);
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

    this.#match.recordElimination("local-player", targetId, nowMs);
    bot.mesh.setEnabled(false);
    this.#showFeedback("ELIMINATION", "elimination", nowMs, 900);
  }

  registerBotHit(botId: string, nowMs: number): void {
    if (this.#match.getState(nowMs).phase !== "in_progress") {
      return;
    }
    const bot = this.#bots.get(botId);
    if (bot?.combat.isAlive !== true) {
      return;
    }

    const result = applyDamage(bot.combat, this.#player, 10, nowMs);
    if (!result.applied) {
      return;
    }
    this.#hud.health.textContent = String(result.remainingHealth);
    if (!result.eliminated) {
      return;
    }

    this.#match.recordElimination(botId, "local-player", nowMs);
    this.#playerMesh.setEnabled(false);
    this.#showFeedback("ELIMINATED", "blocked", nowMs, 900);
  }

  isPlayerAlive(): boolean {
    return this.#player.isAlive;
  }

  update(nowMs: number): void {
    this.#match.update(nowMs);

    for (const bot of this.#bots.values()) {
      if (tryRespawn(bot.combat, nowMs)) {
        bot.mesh.position.copyFrom(bot.spawnPosition);
        bot.mesh.setEnabled(true);
        this.#showFeedback("BOT RESPAWNED", "respawn", nowMs, 700);
      }
    }
    if (tryRespawn(this.#player, nowMs)) {
      this.#playerMesh.position.copyFrom(this.#playerSpawnPosition);
      this.#playerMesh.setEnabled(true);
      this.#hud.health.textContent = String(this.#player.health);
      this.#showFeedback("RESPAWNED", "respawn", nowMs, 700);
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
    if (this.#player.respawnAtMs === undefined) {
      this.#hud.respawn.hidden = true;
      return;
    }

    this.#hud.respawn.hidden = false;
    this.#hud.respawn.textContent = `RESPAWNING IN ${String(Math.ceil((this.#player.respawnAtMs - nowMs) / 1_000))}`;
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
