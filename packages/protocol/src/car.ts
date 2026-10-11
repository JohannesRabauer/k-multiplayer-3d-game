import { z } from "zod";

/**
 * A car design is the complete, serialisable description of a player's car.
 * Like a skin it is plain data: stored on the device, sent to the server,
 * relayed to the room, and turned into meshes by every client the same way.
 */
export const CAR_OPTIONS = {
  bodyStyle: ["sedan", "hatchback", "sports", "pickup"],
  rims: ["standard", "sport", "turbo", "retro"],
  spoiler: ["none", "lip", "wing", "tall"],
  roof: ["none", "rack", "lightbar", "skibox"],
  stripes: ["none", "single", "double", "side"],
  lights: ["classic", "xenon", "neon"]
} as const;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const carSchema = z
  .object({
    bodyStyle: z.enum(CAR_OPTIONS.bodyStyle),
    paintColor: hexColorSchema,
    rims: z.enum(CAR_OPTIONS.rims),
    rimColor: hexColorSchema,
    spoiler: z.enum(CAR_OPTIONS.spoiler),
    spoilerColor: hexColorSchema,
    roof: z.enum(CAR_OPTIONS.roof),
    stripes: z.enum(CAR_OPTIONS.stripes),
    stripeColor: hexColorSchema,
    lights: z.enum(CAR_OPTIONS.lights)
  })
  .strict();

export type CarDesign = z.infer<typeof carSchema>;

export const DEFAULT_CAR: CarDesign = {
  bodyStyle: "sedan",
  paintColor: "#e63946",
  rims: "standard",
  rimColor: "#d9dde2",
  spoiler: "none",
  spoilerColor: "#1d1d1f",
  roof: "none",
  stripes: "none",
  stripeColor: "#ffffff",
  lights: "classic"
};

export const CAR_STORAGE_KEY = "scooter-shooter.car.v1";

/** Lower-cases colours so equal designs compare equal and render identically. */
export function normalizeCar(car: CarDesign): CarDesign {
  return {
    ...car,
    paintColor: car.paintColor.toLowerCase(),
    rimColor: car.rimColor.toLowerCase(),
    spoilerColor: car.spoilerColor.toLowerCase(),
    stripeColor: car.stripeColor.toLowerCase()
  };
}

/** Returns a valid design for untrusted input, or the default when invalid. */
export function parseCarOrDefault(value: unknown): CarDesign {
  const result = carSchema.safeParse(value);
  return result.success ? normalizeCar(result.data) : { ...DEFAULT_CAR };
}

/** Reads stored JSON, falling back to the default design when unusable. */
export function parseStoredCar(raw: string | null): CarDesign {
  if (raw === null) {
    return { ...DEFAULT_CAR };
  }
  try {
    return parseCarOrDefault(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CAR };
  }
}

export function serializeCar(car: CarDesign): string {
  return JSON.stringify(normalizeCar(car));
}

/** Paint jobs for the cars that fill the lot when no other player owns a bay. */
export const NPC_CARS: readonly CarDesign[] = [
  { ...DEFAULT_CAR, bodyStyle: "hatchback", paintColor: "#3a86ff" },
  {
    ...DEFAULT_CAR,
    bodyStyle: "pickup",
    paintColor: "#2a9d8f",
    roof: "rack",
    rims: "retro"
  },
  {
    ...DEFAULT_CAR,
    bodyStyle: "sports",
    paintColor: "#ffbe0b",
    stripes: "double",
    stripeColor: "#111111",
    spoiler: "wing"
  },
  { ...DEFAULT_CAR, bodyStyle: "sedan", paintColor: "#8d99ae", rims: "sport" },
  {
    ...DEFAULT_CAR,
    bodyStyle: "hatchback",
    paintColor: "#9b5de5",
    spoiler: "lip",
    lights: "neon"
  },
  {
    ...DEFAULT_CAR,
    bodyStyle: "sedan",
    paintColor: "#f8f9fa",
    stripes: "side",
    stripeColor: "#ef476f"
  },
  {
    ...DEFAULT_CAR,
    bodyStyle: "sports",
    paintColor: "#06d6a0",
    rims: "turbo",
    lights: "xenon"
  }
];
