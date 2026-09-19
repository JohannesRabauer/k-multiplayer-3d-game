import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";

interface BrowserPerformance extends Performance {
  readonly memory?: {
    readonly usedJSHeapSize: number;
  };
}

export class PerformanceMonitor {
  readonly #engine: Engine;
  readonly #mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  readonly #output: HTMLOutputElement;
  readonly #scene: Scene;
  readonly #timer: number;

  constructor(
    engine: Engine,
    scene: Scene,
    output: HTMLOutputElement,
    searchParameters: URLSearchParams
  ) {
    this.#engine = engine;
    this.#output = output;
    this.#scene = scene;

    const debugEnabled = searchParameters.get("debug") === "performance";
    const reducedEffects =
      this.#mediaQuery.matches || searchParameters.get("quality") === "low";

    output.hidden = !debugEnabled;
    document.documentElement.dataset.reducedEffects = String(reducedEffects);
    this.#applyReducedEffects(reducedEffects);
    this.#mediaQuery.addEventListener("change", this.#onPreferenceChanged);

    this.#timer = window.setInterval(() => {
      this.#renderStats();
    }, 1_000);
    this.#renderStats();
  }

  dispose(): void {
    window.clearInterval(this.#timer);
    this.#mediaQuery.removeEventListener("change", this.#onPreferenceChanged);
  }

  readonly #onPreferenceChanged = (event: MediaQueryListEvent): void => {
    document.documentElement.dataset.reducedEffects = String(event.matches);
    this.#applyReducedEffects(event.matches);
  };

  #applyReducedEffects(enabled: boolean): void {
    this.#scene.particlesEnabled = !enabled;
    this.#scene.postProcessesEnabled = !enabled;
    this.#scene.shadowsEnabled = !enabled;
  }

  #renderStats(): void {
    const browserPerformance = performance as BrowserPerformance;
    const heapMegabytes =
      browserPerformance.memory === undefined
        ? "n/a"
        : (browserPerformance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(0);

    this.#output.value = [
      `${this.#engine.getFps().toFixed(0)} FPS`,
      `${String(this.#scene.getActiveMeshes().length)} active meshes`,
      `${heapMegabytes} MB JS heap`
    ].join(" · ");
  }
}
