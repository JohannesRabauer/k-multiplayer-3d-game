import {
  SKIN_LIBRARY_STORAGE_KEY,
  parseSkinLibrary,
  serializeSkinLibrary,
  type SkinLibrary
} from "@scooter-shooter/protocol";

/**
 * Persists the player's skins in the browser. Storage can be unavailable
 * (private mode, blocked cookies), in which case skins last for the session.
 */
export function loadSkinLibrary(): SkinLibrary {
  try {
    return parseSkinLibrary(
      window.localStorage.getItem(SKIN_LIBRARY_STORAGE_KEY)
    );
  } catch {
    return parseSkinLibrary(null);
  }
}

/** Returns false when the browser refused to store the library. */
export function saveSkinLibrary(library: SkinLibrary): boolean {
  try {
    window.localStorage.setItem(
      SKIN_LIBRARY_STORAGE_KEY,
      serializeSkinLibrary(library)
    );
    return true;
  } catch {
    return false;
  }
}
