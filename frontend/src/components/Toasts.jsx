import { useAdminNotifications } from "../hooks/useAdminNotifications";
import "./Toasts.css";

export function Toasts() {
  const { toasts } = useAdminNotifications();

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
