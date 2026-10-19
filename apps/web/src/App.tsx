import { useEffect, useRef } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { getSession, UnauthorizedError } from "./api";
import { Babysitters } from "./routes/Babysitters";
import { Calendar } from "./routes/Calendar";
import { History } from "./routes/History";
import { Import } from "./routes/Import";
import { Login } from "./routes/Login";
import { useSyncTriggers } from "./sync/triggers";

// The router itself (BrowserRouter) is in main.tsx, so tests can use a MemoryRouter.
export function App() {
  useSessionCheck();
  useSyncTriggers();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/import" element={<Import />} />
      <Route path="/babysitters" element={<Babysitters />} />
      <Route path="/history" element={<History />} />
      <Route path="*" element={<Calendar />} />
    </Routes>
  );
}

// On start, when online, asks the server whether the session is still valid and goes to /login
// if not. Offline the app trusts its local data and stays put (docs/design.md § Authentication).
// Opening on /login skips the check, so a slow 401 can't follow a fresh sign-in.
function useSessionCheck() {
  const navigate = useNavigate();
  const startPath = useRef(useLocation().pathname);
  useEffect(() => {
    if (!navigator.onLine || startPath.current === "/login") return;
    let cancelled = false;
    getSession().catch((err: unknown) => {
      if (!cancelled && err instanceof UnauthorizedError) navigate("/login", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
}
