import { Modal } from "./Modal";

export function ConfirmDialog({ open, message, onConfirm, onCancel }) {
  return (
    <Modal open={open} onClose={onCancel}>
      <p style={{ marginBottom: "var(--space-xl)", fontSize: "var(--font-size-md)", color: "var(--color-text)" }}>{message}</p>
      <div className="btn-row" style={{ justifyContent: "center" }}>
        <button className="btn btn-secondary" onClick={onCancel}>Non</button>
        <button className="btn" style={{ background: "var(--color-danger)", color: "#fff" }} onClick={onConfirm}>Oui, annuler</button>
      </div>
    </Modal>
  );
}
