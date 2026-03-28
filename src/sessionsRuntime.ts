import type { SessionStore } from "./sessionStore.js";
import {
  createNewSession,
  type CallSession,
} from "./sessionModel.js";

let store: SessionStore | null = null;

export function setSessionStore(s: SessionStore): void {
  store = s;
}

function requireStore(): SessionStore {
  if (!store) {
    throw new Error("Session store not initialized");
  }
  return store;
}

export async function loadOrCreateSession(
  sessionId: string,
  phone: string
): Promise<CallSession> {
  const st = requireStore();
  const cur = await st.get(sessionId);
  if (cur) {
    return { ...cur };
  }
  const created = createNewSession(phone);
  await st.set(sessionId, created);
  return { ...created };
}

export async function saveSession(
  sessionId: string,
  session: CallSession
): Promise<void> {
  await requireStore().set(sessionId, { ...session });
}

export async function storePing(): Promise<boolean> {
  return requireStore().ping();
}
