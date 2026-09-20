import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type Auth,
  type User
} from "firebase/auth";

export interface AuthSession {
  readonly displayName: string;
  readonly isAnonymous: boolean;
  readonly userId: string;
}

export type AuthStateListener = (session: AuthSession | null) => void;

export class FirebaseAuthController {
  readonly #auth: Auth;
  readonly #googleProvider = new GoogleAuthProvider();

  constructor(options: FirebaseOptions) {
    this.#auth = getAuth(initializeApp(options));
  }

  async initialize(listener: AuthStateListener): Promise<() => void> {
    await setPersistence(this.#auth, browserLocalPersistence);
    return onAuthStateChanged(this.#auth, (user) => {
      listener(user === null ? null : toAuthSession(user));
    });
  }

  async continueAsGuest(): Promise<void> {
    if (this.#auth.currentUser !== null) {
      return;
    }
    await signInAnonymously(this.#auth);
  }

  async continueWithGoogle(): Promise<void> {
    const currentUser = this.#auth.currentUser;
    if (currentUser?.isAnonymous === true) {
      await linkWithPopup(currentUser, this.#googleProvider);
      return;
    }
    if (currentUser === null) {
      await signInWithPopup(this.#auth, this.#googleProvider);
    }
  }

  async switchToExistingGoogleAccount(): Promise<void> {
    await signOut(this.#auth);
    await signInWithPopup(this.#auth, this.#googleProvider);
  }

  async signOut(): Promise<void> {
    await signOut(this.#auth);
  }
}

export function readFirebaseOptions(
  environment: ImportMetaEnv
): FirebaseOptions | null {
  const apiKey = environment.VITE_FIREBASE_API_KEY;
  const appId = environment.VITE_FIREBASE_APP_ID;
  const authDomain = environment.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = environment.VITE_FIREBASE_PROJECT_ID;

  if (
    apiKey === undefined ||
    appId === undefined ||
    authDomain === undefined ||
    projectId === undefined
  ) {
    return null;
  }

  const options: FirebaseOptions = {
    apiKey,
    appId,
    authDomain,
    projectId
  };
  if (environment.VITE_FIREBASE_MESSAGING_SENDER_ID !== undefined) {
    options.messagingSenderId = environment.VITE_FIREBASE_MESSAGING_SENDER_ID;
  }
  if (environment.VITE_FIREBASE_STORAGE_BUCKET !== undefined) {
    options.storageBucket = environment.VITE_FIREBASE_STORAGE_BUCKET;
  }
  return options;
}

export function isAccountConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === "auth/credential-already-in-use" ||
    error.code === "auth/email-already-in-use"
  );
}

export function getAuthErrorMessage(error: unknown): string {
  if (isAccountConflict(error)) {
    return "This Google account already has a profile. Confirm below to switch accounts; guest progress will stay with the guest profile.";
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "auth/popup-closed-by-user") {
      return "Google sign-in was closed before it finished.";
    }
    if (error.code === "auth/popup-blocked") {
      return "The browser blocked Google sign-in. Allow popups and try again.";
    }
    if (error.code === "auth/network-request-failed") {
      return "Authentication could not reach Firebase. Check the connection and try again.";
    }
  }
  return "Authentication failed. Please try again.";
}

function toAuthSession(user: User): AuthSession {
  return {
    displayName:
      user.displayName ??
      (user.isAnonymous ? "Guest player" : (user.email ?? "Player")),
    isAnonymous: user.isAnonymous,
    userId: user.uid
  };
}
