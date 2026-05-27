import { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from "react";
import {
  getAuthSession,
  setAuthSession,
  clearAuthSession,
  notifyAuthChange,
  DuncanSession,
  DuncanUser,
} from "@/lib/authStorage";
import { API_BASE_URL } from "@/lib/apiConfig";

interface AuthContextType {
  session: DuncanSession | null;
  user: DuncanUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Sign out after 8 hours of no mouse/keyboard/touch activity
const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

const FASTAPI_HEADERS = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "1",
};

function isTokenExpired(sess: DuncanSession): boolean {
  if (!sess.expires_at) return false;
  return sess.expires_at * 1000 < Date.now();
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<DuncanSession | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const refreshing = useRef(false);

  const clearTimer = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const doSignOut = useCallback(async () => {
    clearTimer();
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    const sess = getAuthSession();
    if (sess?.access_token) {
      try {
        await fetch(`${API_BASE_URL}/auth/signout`, {
          method: "POST",
          headers: { ...FASTAPI_HEADERS, Authorization: `Bearer ${sess.access_token}` },
        });
      } catch {
        // best effort
      }
    }
    clearAuthSession();
    sessionStorage.removeItem("duncan_briefing_done");
    setSession(null);
    notifyAuthChange(false);
  }, [clearTimer]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      doSignOut();
    }, IDLE_TIMEOUT_MS);
  }, [doSignOut]);

  const doRefresh = useCallback(
    async (refreshToken: string) => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: FASTAPI_HEADERS,
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) {
          await doSignOut();
          return;
        }
        const data = await res.json();
        const newSession: DuncanSession = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
          user: data.user,
        };
        setAuthSession(newSession);
        setSession(newSession);
        scheduleRefresh(newSession);
      } catch {
        // swallow network errors silently
      } finally {
        refreshing.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doSignOut],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scheduleRefresh = useCallback(
    (sess: DuncanSession) => {
      clearTimer();
      if (!sess.expires_at) return;
      const delay = sess.expires_at * 1000 - Date.now() - REFRESH_BUFFER_MS;
      if (delay <= 0) {
        doRefresh(sess.refresh_token);
        return;
      }
      refreshTimer.current = window.setTimeout(() => doRefresh(sess.refresh_token), delay);
    },
    [clearTimer, doRefresh],
  );

  useEffect(() => {
    const existing = getAuthSession();
    if (existing) {
      if (isTokenExpired(existing)) {
        // Token is already expired — attempt refresh before exposing the session.
        // Keep loading=true until refresh completes so ProtectedRoute blocks rendering.
        doRefresh(existing.refresh_token).finally(() => setLoading(false));
      } else {
        setSession(existing);
        scheduleRefresh(existing);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    const onAuthChange = (e: Event) => {
      const { loggedIn } = (e as CustomEvent<{ loggedIn: boolean }>).detail;
      if (!loggedIn) setSession(null);
    };
    window.addEventListener("duncan-auth-change", onAuthChange);
    return () => {
      window.removeEventListener("duncan-auth-change", onAuthChange);
      clearTimer();
    };
  }, [scheduleRefresh, clearTimer, doRefresh]);

  // Idle timeout — reset on any user activity
  useEffect(() => {
    if (!session) return;
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    const handler = () => resetIdleTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetIdleTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [session, resetIdleTimer]);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut: doSignOut }}>
      {children}
    </AuthContext.Provider>
  );
};
