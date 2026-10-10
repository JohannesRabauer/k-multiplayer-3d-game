import { z } from "zod";

import { DEFAULT_SKIN, normalizeSkin, skinSchema, type Skin } from "./skin.js";

/** A named skin the player saved. */
export interface SavedSkin {
  readonly id: string;
  readonly name: string;
  readonly skin: Skin;
}

/** Everything persisted on the device: the saved skins and which one is worn. */
export interface SkinLibrary {
  readonly skins: readonly SavedSkin[];
  readonly activeId: string;
}

export const MAX_SAVED_SKINS = 12;
export const MAX_SKIN_NAME_LENGTH = 24;
export const SKIN_LIBRARY_STORAGE_KEY = "scooter-shooter.skins.v1";

const savedSkinSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(MAX_SKIN_NAME_LENGTH),
    skin: skinSchema
  })
  .strict();

const libraryStorageSchema = z
  .object({
    version: z.literal(1),
    activeId: z.string(),
    skins: z.array(savedSkinSchema).min(1).max(MAX_SAVED_SKINS)
  })
  .strict();

export function createDefaultLibrary(): SkinLibrary {
  return {
    activeId: "default",
    skins: [{ id: "default", name: "My skin", skin: { ...DEFAULT_SKIN } }]
  };
}

/** Reads stored JSON, falling back to the default library when it is unusable. */
export function parseSkinLibrary(raw: string | null): SkinLibrary {
  if (raw === null) {
    return createDefaultLibrary();
  }
  try {
    const parsed = libraryStorageSchema.parse(JSON.parse(raw));
    const skins = parsed.skins.map((saved) => ({
      ...saved,
      skin: normalizeSkin(saved.skin)
    }));
    const activeId = skins.some((saved) => saved.id === parsed.activeId)
      ? parsed.activeId
      : (skins[0]?.id ?? "default");
    return { skins, activeId };
  } catch {
    return createDefaultLibrary();
  }
}

export function serializeSkinLibrary(library: SkinLibrary): string {
  return JSON.stringify({ version: 1, ...library });
}

export function getActiveSkin(library: SkinLibrary): Skin {
  return (
    library.skins.find((saved) => saved.id === library.activeId)?.skin ?? {
      ...DEFAULT_SKIN
    }
  );
}

/** Saves a skin under a name, replacing the entry with the same id if any. */
export function upsertSkin(
  library: SkinLibrary,
  saved: SavedSkin,
  makeActive = true
): SkinLibrary {
  const entry: SavedSkin = {
    id: saved.id,
    name: saved.name.trim().slice(0, MAX_SKIN_NAME_LENGTH) || "My skin",
    skin: normalizeSkin(saved.skin)
  };
  const exists = library.skins.some((item) => item.id === entry.id);
  if (!exists && library.skins.length >= MAX_SAVED_SKINS) {
    return library;
  }
  const skins = exists
    ? library.skins.map((item) => (item.id === entry.id ? entry : item))
    : [...library.skins, entry];
  return { skins, activeId: makeActive ? entry.id : library.activeId };
}

export function removeSkin(library: SkinLibrary, id: string): SkinLibrary {
  const skins = library.skins.filter((item) => item.id !== id);
  if (skins.length === 0) {
    return createDefaultLibrary();
  }
  const activeId = skins.some((item) => item.id === library.activeId)
    ? library.activeId
    : (skins[0]?.id ?? "default");
  return { skins, activeId };
}

export function selectSkin(library: SkinLibrary, id: string): SkinLibrary {
  return library.skins.some((item) => item.id === id)
    ? { ...library, activeId: id }
    : library;
}
