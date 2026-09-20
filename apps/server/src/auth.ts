import { createPublicKey, createVerify } from "node:crypto";

export interface VerifiedIdentity {
  readonly accountId: string;
  readonly displayName: string;
  readonly isGuest: boolean;
}

export interface TokenVerifierOptions {
  /** Firebase project id; tokens must carry it as both audience and issuer. */
  readonly projectId: string | undefined;
  /**
   * Skips signature verification. Only ever enabled explicitly for local
   * development and automated tests, never in a deployed environment.
   */
  readonly allowUnverifiedTokens: boolean;
  readonly fetchImplementation?: typeof fetch;
}

const GOOGLE_PUBLIC_KEYS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const ISSUER_PREFIX = "https://securetoken.google.com/";
/** Allowance for clock drift between this service and Google. */
const CLOCK_SKEW_SECONDS = 300;

interface JwtPayload {
  readonly aud?: unknown;
  readonly auth_time?: unknown;
  readonly exp?: unknown;
  readonly firebase?: unknown;
  readonly iat?: unknown;
  readonly iss?: unknown;
  readonly name?: unknown;
  readonly sub?: unknown;
}

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenVerificationError";
  }
}

/**
 * Verifies Firebase ID tokens against Google's published X.509 certificates.
 *
 * The certificates are cached until the `max-age` Google advertises, so a busy
 * room costs no extra outbound requests.
 */
export class FirebaseTokenVerifier {
  readonly #options: TokenVerifierOptions;
  readonly #fetch: typeof fetch;
  #certificates = new Map<string, string>();
  #certificatesExpireAtMs = 0;
  #inFlight: Promise<void> | undefined;

  constructor(options: TokenVerifierOptions) {
    this.#options = options;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async verify(token: string, nowMs: number): Promise<VerifiedIdentity> {
    const segments = token.split(".");
    if (segments.length !== 3) {
      throw new TokenVerificationError("malformed token");
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments as [
      string,
      string,
      string
    ];

    const header = decodeJsonSegment(headerSegment) as {
      readonly alg?: unknown;
      readonly kid?: unknown;
    };
    const payload = decodeJsonSegment(payloadSegment) as JwtPayload;

    const subject = typeof payload.sub === "string" ? payload.sub : "";
    if (subject.length === 0 || subject.length > 128) {
      throw new TokenVerificationError("token is missing a subject");
    }

    const nowSeconds = Math.floor(nowMs / 1000);
    const expiry = typeof payload.exp === "number" ? payload.exp : 0;
    if (expiry + CLOCK_SKEW_SECONDS < nowSeconds) {
      throw new TokenVerificationError("token has expired");
    }
    const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
    if (issuedAt - CLOCK_SKEW_SECONDS > nowSeconds) {
      throw new TokenVerificationError("token is not yet valid");
    }

    if (!this.#options.allowUnverifiedTokens) {
      const projectId = this.#options.projectId;
      if (projectId === undefined || projectId.length === 0) {
        throw new TokenVerificationError("server has no configured project id");
      }
      if (payload.aud !== projectId) {
        throw new TokenVerificationError("token audience does not match");
      }
      if (payload.iss !== `${ISSUER_PREFIX}${projectId}`) {
        throw new TokenVerificationError("token issuer does not match");
      }
      if (header.alg !== "RS256") {
        throw new TokenVerificationError("unsupported token algorithm");
      }

      const keyId = typeof header.kid === "string" ? header.kid : "";
      const certificate = await this.#getCertificate(keyId, nowMs);
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${headerSegment}.${payloadSegment}`);
      verifier.end();

      const isValid = verifier.verify(
        createPublicKey(certificate),
        Buffer.from(signatureSegment, "base64url")
      );
      if (!isValid) {
        throw new TokenVerificationError("token signature is invalid");
      }
    }

    const providerId = readSignInProvider(payload.firebase);
    const name = typeof payload.name === "string" ? payload.name.trim() : "";

    return {
      accountId: subject,
      displayName: toDisplayName(name, subject),
      isGuest: providerId === "anonymous"
    };
  }

  async #getCertificate(keyId: string, nowMs: number): Promise<string> {
    if (nowMs >= this.#certificatesExpireAtMs) {
      this.#inFlight ??= this.#refreshCertificates(nowMs).finally(() => {
        this.#inFlight = undefined;
      });
      await this.#inFlight;
    }

    const certificate = this.#certificates.get(keyId);
    if (certificate === undefined) {
      throw new TokenVerificationError("token key id is unknown");
    }
    return certificate;
  }

  async #refreshCertificates(nowMs: number): Promise<void> {
    const response = await this.#fetch(GOOGLE_PUBLIC_KEYS_URL);
    if (!response.ok) {
      throw new TokenVerificationError("could not load signing certificates");
    }

    const body = (await response.json()) as Record<string, string>;
    this.#certificates = new Map(Object.entries(body));

    const cacheControl = response.headers.get("cache-control") ?? "";
    const maxAge = /max-age=(\d+)/u.exec(cacheControl)?.[1];
    const ttlSeconds = maxAge === undefined ? 3600 : Number(maxAge);
    this.#certificatesExpireAtMs =
      nowMs + Math.max(60, Math.min(ttlSeconds, 86_400)) * 1000;
  }
}

function decodeJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new TokenVerificationError("token contains malformed json");
  }
}

function readSignInProvider(firebase: unknown): string {
  if (typeof firebase !== "object" || firebase === null) {
    return "";
  }
  const provider = (firebase as { readonly sign_in_provider?: unknown })
    .sign_in_provider;
  return typeof provider === "string" ? provider : "";
}

function toDisplayName(name: string, subject: string): string {
  if (name.length > 0) {
    return name.slice(0, 64);
  }
  return `Guest-${subject.slice(0, 4).toUpperCase()}`;
}
