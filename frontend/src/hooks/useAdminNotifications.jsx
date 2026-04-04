import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";

const AdminNotifContext = createContext(null);

export function AdminNotifProvider({ children }) {
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("adminSound") === "1");
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const audioCtx = useRef(null);
  const esRef = useRef(null);
  const listenersRef = useRef(new Set());

  // Toggle sound
  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("adminSound", next ? "1" : "0");
      if (next && !audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
      return next;
    });
  }, []);

  // Play sound
  const playSound = useCallback(() => {
    if (!soundEnabled || !audioCtx.current) return;
    const ctx = audioCtx.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.start();
    osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
  }, [soundEnabled]);

  // Add toast notification
  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  // Subscribe to order events (pages can register callbacks)
  const onOrderEvent = useCallback((callback) => {
    listenersRef.current.add(callback);
    return () => listenersRef.current.delete(callback);
  }, []);

  // SSE connection
  useEffect(() => {
    const es = new EventSource("/api/admin/orders/stream");
    esRef.current = es;

    es.addEventListener("connected", () => setConnected(true));
    es.onerror = () => setConnected(false);

    es.addEventListener("order-new", (e) => {
      const data = JSON.parse(e.data);
      playSound();
      addToast(`Nouvelle commande #${data.order_number} — ${data.student_name}`, "new");
      setPendingCount((p) => p + 1);
      listenersRef.current.forEach((cb) => cb("order-new", data));
    });

    es.addEventListener("order-update", (e) => {
      const data = JSON.parse(e.data);
      playSound();
      const statusLabels = { preparing: "en préparation", ready: "prête", cancelled: "annulée" };
      addToast(`Commande #${data.order_number} → ${statusLabels[data.status] || data.status}`, "update");
      listenersRef.current.forEach((cb) => cb("order-update", data));
    });

    return () => es.close();
  }, [playSound, addToast]);

  // Reset pending count when orders page is viewed
  const clearPending = useCallback(() => setPendingCount(0), []);

  return (
    <AdminNotifContext.Provider value={{ soundEnabled, toggleSound, connected, toasts, pendingCount, clearPending, onOrderEvent }}>
      {children}
    </AdminNotifContext.Provider>
  );
}

export const useAdminNotifications = () => useContext(AdminNotifContext);
