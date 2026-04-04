export function Modal({ open, onClose, children, top = false, wide = false }) {
  if (!open) return null;
  return (
    <div className="modal-overlay open" style={top ? { alignItems: "flex-start", paddingTop: "3rem" } : {}} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: wide ? "500px" : "380px" }}>
        {children}
      </div>
    </div>
  );
}
