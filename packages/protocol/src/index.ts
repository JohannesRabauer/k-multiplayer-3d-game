import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const identifierSchema = z.string().min(1).max(128);
const timestampSchema = z.number().int().nonnegative();
const sequenceSchema = z.number().int().nonnegative();

export const vector2Schema = z
  .object({
    x: z.number(),
    y: z.number()
  })
  .strict();

export const vector3Schema = z
  .object({
    x: z.number(),
    y: z.number(),
    z: z.number()
  })
  .strict();

export const teamSchema = z.enum(["blue", "red"]);
export const matchPhaseSchema = z.enum([
  "waiting_for_players",
  "countdown",
  "in_progress",
  "ended",
  "resetting"
]);

export const inputFrameSchema = z
  .object({
    sequence: sequenceSchema,
    clientTimeMs: timestampSchema,
    movement: vector2Schema,
    aimYaw: z.number(),
    aimPitch: z.number()
  })
  .strict();

const helloSchema = z
  .object({
    type: z.literal("hello"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    authToken: z.string().min(1).max(16_384),
    clientBuild: z.string().min(1).max(128)
  })
  .strict();

const joinQuickPlaySchema = z
  .object({
    type: z.literal("joinQuickPlay")
  })
  .strict();

const inputBatchSchema = z
  .object({
    type: z.literal("inputBatch"),
    frames: z.array(inputFrameSchema).min(1).max(16)
  })
  .strict();

const fireIntentSchema = z
  .object({
    type: z.literal("fireIntent"),
    inputSequence: sequenceSchema,
    clientShotTimeMs: timestampSchema,
    aimOrigin: vector3Schema,
    aimDirection: vector3Schema
  })
  .strict();

const heartbeatSchema = z
  .object({
    type: z.literal("heartbeat"),
    clientTimeMs: timestampSchema
  })
  .strict();

const leaveMatchSchema = z
  .object({
    type: z.literal("leaveMatch")
  })
  .strict();

export const clientMessageSchema = z.discriminatedUnion("type", [
  helloSchema,
  joinQuickPlaySchema,
  inputBatchSchema,
  fireIntentSchema,
  heartbeatSchema,
  leaveMatchSchema
]);

const welcomeSchema = z
  .object({
    type: z.literal("welcome"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    serverBuild: z.string().min(1).max(128),
    serverTimeMs: timestampSchema
  })
  .strict();

const joinAcceptedSchema = z
  .object({
    type: z.literal("joinAccepted"),
    playerId: identifierSchema,
    roomId: identifierSchema,
    reconnectToken: z.string().min(32).max(512),
    team: teamSchema,
    serverTick: sequenceSchema
  })
  .strict();

const joinRejectedSchema = z
  .object({
    type: z.literal("joinRejected"),
    reason: z.enum([
      "authentication_required",
      "client_update_required",
      "invalid_request",
      "room_unavailable",
      "server_full"
    ])
  })
  .strict();

export const playerSnapshotSchema = z
  .object({
    playerId: identifierSchema,
    team: teamSchema,
    position: vector3Schema,
    velocity: vector3Schema,
    yaw: z.number(),
    pitch: z.number(),
    health: z.number().int().nonnegative(),
    ammo: z.number().int().nonnegative(),
    isAlive: z.boolean(),
    lastProcessedInput: sequenceSchema
  })
  .strict();

const snapshotSchema = z
  .object({
    type: z.literal("snapshot"),
    serverTick: sequenceSchema,
    serverTimeMs: timestampSchema,
    players: z.array(playerSnapshotSchema).max(20)
  })
  .strict();

const shotResultSchema = z
  .object({
    type: z.literal("shotResult"),
    shooterId: identifierSchema,
    inputSequence: sequenceSchema,
    accepted: z.boolean(),
    hitPlayerId: identifierSchema.nullable(),
    impactPoint: vector3Schema.nullable()
  })
  .strict();

const damageSchema = z
  .object({
    type: z.literal("damage"),
    attackerId: identifierSchema,
    targetId: identifierSchema,
    amount: z.number().int().positive(),
    remainingHealth: z.number().int().nonnegative()
  })
  .strict();

const eliminationSchema = z
  .object({
    type: z.literal("elimination"),
    attackerId: identifierSchema,
    targetId: identifierSchema,
    blueScore: z.number().int().nonnegative(),
    redScore: z.number().int().nonnegative()
  })
  .strict();

const respawnSchema = z
  .object({
    type: z.literal("respawn"),
    playerId: identifierSchema,
    position: vector3Schema,
    yaw: z.number(),
    protectionEndsAtMs: timestampSchema
  })
  .strict();

const matchStateSchema = z
  .object({
    type: z.literal("matchState"),
    phase: matchPhaseSchema,
    blueScore: z.number().int().nonnegative(),
    redScore: z.number().int().nonnegative(),
    remainingMs: timestampSchema,
    winningTeam: teamSchema.nullable()
  })
  .strict();

const protocolErrorSchema = z
  .object({
    type: z.literal("protocolError"),
    code: z.enum([
      "authentication_failed",
      "invalid_message",
      "rate_limited",
      "unsupported_protocol"
    ]),
    fatal: z.boolean()
  })
  .strict();

const serverShutdownSchema = z
  .object({
    type: z.literal("serverShutdown"),
    reconnectAfterMs: z.number().int().nonnegative().max(60_000)
  })
  .strict();

export const serverMessageSchema = z.discriminatedUnion("type", [
  welcomeSchema,
  joinAcceptedSchema,
  joinRejectedSchema,
  snapshotSchema,
  shotResultSchema,
  damageSchema,
  eliminationSchema,
  respawnSchema,
  matchStateSchema,
  protocolErrorSchema,
  serverShutdownSchema
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type InputFrame = z.infer<typeof inputFrameSchema>;
export type MatchPhase = z.infer<typeof matchPhaseSchema>;
export type PlayerSnapshot = z.infer<typeof playerSnapshotSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type Team = z.infer<typeof teamSchema>;
export type Vector2 = z.infer<typeof vector2Schema>;
export type Vector3 = z.infer<typeof vector3Schema>;

export function parseClientMessage(value: unknown): ClientMessage {
  return clientMessageSchema.parse(value);
}

export function parseServerMessage(value: unknown): ServerMessage {
  return serverMessageSchema.parse(value);
}
