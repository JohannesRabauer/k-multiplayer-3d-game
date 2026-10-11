import {
  CAR_STORAGE_KEY,
  parseStoredCar,
  serializeCar,
  type CarDesign
} from "@scooter-shooter/protocol";

/**
 * Persists the player's car in the browser. Storage can be unavailable
 * (private mode, blocked cookies), in which case the design lasts for the
 * session only.
 */
export function loadCar(): CarDesign {
  try {
    return parseStoredCar(window.localStorage.getItem(CAR_STORAGE_KEY));
  } catch {
    return parseStoredCar(null);
  }
}

/** Returns false when the browser refused to store the design. */
export function saveCar(car: CarDesign): boolean {
  try {
    window.localStorage.setItem(CAR_STORAGE_KEY, serializeCar(car));
    return true;
  } catch {
    return false;
  }
}
