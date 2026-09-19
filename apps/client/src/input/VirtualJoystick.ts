export interface VirtualJoystickOptions {
  readonly deadZone: number;
  readonly onInput: (x: number, y: number) => void;
}

export class VirtualJoystick {
  readonly #element: HTMLElement;
  readonly #knob: HTMLElement;
  readonly #options: VirtualJoystickOptions;
  #pointerId: number | undefined;

  constructor(element: HTMLElement, options: VirtualJoystickOptions) {
    const knob = element.querySelector<HTMLElement>(".joystick__knob");
    if (knob === null) {
      throw new Error("Virtual joystick requires a .joystick__knob element.");
    }

    this.#element = element;
    this.#knob = knob;
    this.#options = options;

    element.addEventListener("pointerdown", this.#onPointerDown);
    element.addEventListener("pointermove", this.#onPointerMove);
    element.addEventListener("pointerup", this.#onPointerEnd);
    element.addEventListener("pointercancel", this.#onPointerEnd);
    element.addEventListener("lostpointercapture", this.#onPointerEnd);
  }

  dispose(): void {
    this.#element.removeEventListener("pointerdown", this.#onPointerDown);
    this.#element.removeEventListener("pointermove", this.#onPointerMove);
    this.#element.removeEventListener("pointerup", this.#onPointerEnd);
    this.#element.removeEventListener("pointercancel", this.#onPointerEnd);
    this.#element.removeEventListener("lostpointercapture", this.#onPointerEnd);
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#pointerId !== undefined) {
      return;
    }

    this.#pointerId = event.pointerId;
    this.#element.setPointerCapture(event.pointerId);
    this.#updateFromPointer(event);
    event.preventDefault();
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) {
      return;
    }

    this.#updateFromPointer(event);
    event.preventDefault();
  };

  readonly #onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) {
      return;
    }

    this.#pointerId = undefined;
    this.#knob.style.transform = "translate3d(0, 0, 0)";
    this.#options.onInput(0, 0);
    event.preventDefault();
  };

  #updateFromPointer(event: PointerEvent): void {
    const bounds = this.#element.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) / 2);
    const offsetX = event.clientX - (bounds.left + bounds.width / 2);
    const offsetY = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(offsetX, offsetY);
    const scale = distance > radius ? radius / distance : 1;
    const clampedX = offsetX * scale;
    const clampedY = offsetY * scale;
    const normalizedX = clampedX / radius;
    const normalizedY = -clampedY / radius;
    const normalizedMagnitude = Math.hypot(normalizedX, normalizedY);

    this.#knob.style.transform = `translate3d(${String(clampedX)}px, ${String(clampedY)}px, 0)`;

    if (normalizedMagnitude <= this.#options.deadZone) {
      this.#options.onInput(0, 0);
      return;
    }
    this.#options.onInput(normalizedX, normalizedY);
  }
}
