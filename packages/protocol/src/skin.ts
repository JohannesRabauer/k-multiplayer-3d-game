import { z } from "zod";

/**
 * A skin is the complete, serialisable description of a player's look. It is
 * plain data on purpose: the same object is stored on the device, sent to the
 * server, relayed to the other players, and turned into meshes by the client.
 */
export const SKIN_OPTIONS = {
  eyeShape: ["round", "oval", "narrow", "angry", "big"],
  glasses: ["none", "round", "square", "sunglasses", "goggles"],
  headwear: ["none", "cap", "beanie", "tophat", "soldier", "biker", "knight"],
  top: ["tshirt", "longsleeve", "hoodie", "tank", "jacket"],
  pants: ["jeans", "shorts", "cargo", "skirt"],
  shoes: ["none", "sneakers", "boots", "hightops"]
} as const;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const skinSchema = z
  .object({
    skinColor: hexColorSchema,
    eyeColor: hexColorSchema,
    eyeShape: z.enum(SKIN_OPTIONS.eyeShape),
    glasses: z.enum(SKIN_OPTIONS.glasses),
    headwear: z.enum(SKIN_OPTIONS.headwear),
    headwearColor: hexColorSchema,
    top: z.enum(SKIN_OPTIONS.top),
    topColor: hexColorSchema,
    pants: z.enum(SKIN_OPTIONS.pants),
    pantsColor: hexColorSchema,
    shoes: z.enum(SKIN_OPTIONS.shoes),
    shoesColor: hexColorSchema
  })
  .strict();

export type Skin = z.infer<typeof skinSchema>;

export const DEFAULT_SKIN: Skin = {
  skinColor: "#f1c27d",
  eyeColor: "#3b82f6",
  eyeShape: "round",
  glasses: "none",
  headwear: "none",
  headwearColor: "#d94f4f",
  top: "tshirt",
  topColor: "#57c7ff",
  pants: "jeans",
  pantsColor: "#2f4a7a",
  shoes: "sneakers",
  shoesColor: "#f4f4f4"
};

/** Returns a valid skin for untrusted input, or the default when it is invalid. */
export function parseSkinOrDefault(value: unknown): Skin {
  const result = skinSchema.safeParse(value);
  return result.success ? normalizeSkin(result.data) : { ...DEFAULT_SKIN };
}

/** Lower-cases colours so equal skins compare equal and render identically. */
export function normalizeSkin(skin: Skin): Skin {
  return {
    ...skin,
    skinColor: skin.skinColor.toLowerCase(),
    eyeColor: skin.eyeColor.toLowerCase(),
    headwearColor: skin.headwearColor.toLowerCase(),
    topColor: skin.topColor.toLowerCase(),
    pantsColor: skin.pantsColor.toLowerCase(),
    shoesColor: skin.shoesColor.toLowerCase()
  };
}
