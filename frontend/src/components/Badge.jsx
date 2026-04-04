const STATUS_MAP = {
  pending: { cls: "badge-pending", label: "En attente" },
  preparing: { cls: "badge-preparing", label: "En préparation" },
  ready: { cls: "badge-ready", label: "Prête!" },
  cancelled: { cls: "badge-cancelled", label: "Annulée" },
  picked_up: { cls: "badge-done", label: "Terminée" },
};

export function Badge({ status, label }) {
  const info = STATUS_MAP[status] || { cls: "", label: label || status };
  return <span className={`badge ${info.cls}`}>{label || info.label}</span>;
}
