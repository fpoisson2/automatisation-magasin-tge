require("dotenv").config();
const EventSource = require("eventsource");
const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const SERVER_URL = process.env.SERVER_URL;
const PRINT_TOKEN = process.env.PRINT_TOKEN;
const PRINTER_VID = parseInt(process.env.PRINTER_VID, 16) || undefined;
const PRINTER_PID = parseInt(process.env.PRINTER_PID, 16) || undefined;

if (!SERVER_URL || !PRINT_TOKEN) {
  console.error("SERVER_URL et PRINT_TOKEN requis dans .env");
  process.exit(1);
}

// ── Printer setup ──
let device;
try {
  device = new escpos.USB(PRINTER_VID, PRINTER_PID);
  console.log("Imprimante USB trouvée.");
} catch (err) {
  console.error("Imprimante non trouvée. Vérifiez la connexion USB.");
  console.error("Lancez 'lsusb' pour trouver le VID:PID de votre imprimante.");
  console.error(err.message);
  process.exit(1);
}

const printer = new escpos.Printer(device);

function printReceipt(order) {
  return new Promise((resolve, reject) => {
    device.open((err) => {
      if (err) return reject(err);

      const now = new Date();
      const date = now.toLocaleDateString("fr-CA");
      const time = now.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });

      printer
        .align("ct")
        .style("b")
        .size(1, 1)
        .text("MAGASIN TGE")
        .style("normal")
        .text("================================")
        .newLine()
        .align("ct")
        .style("b")
        .size(2, 2)
        .text(`#${order.order_number}`)
        .size(1, 1)
        .style("normal")
        .newLine()
        .align("lt")
        .text(`${order.student_name}`)
        .text(`DA: ${order.student_da}`)
        .text(`${date} ${time}`)
        .text("--------------------------------");

      let totalQty = 0;
      for (const item of order.items || []) {
        const qty = item.quantity || 1;
        totalQty += qty;
        printer
          .style("b")
          .text(`x${qty}  #${item.article_no}`)
          .style("normal")
          .text(`    ${(item.description || "").substring(0, 32)}`);

        if (item.localisation) {
          printer.text(`    -> ${item.localisation}`);
        }
        printer.newLine();
      }

      printer
        .text("--------------------------------")
        .text(`${totalQty} article${totalQty > 1 ? "s" : ""}`)
        .text("================================")
        .newLine()
        .newLine()
        .newLine()
        .cut()
        .close(resolve);
    });
  });
}

// ── Acknowledge print to server ──
async function ackPrint(orderNumber) {
  try {
    const res = await fetch(`${SERVER_URL}/api/print-ack/${orderNumber}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PRINT_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`Ack failed for #${orderNumber}:`, await res.text());
    }
  } catch (err) {
    console.error(`Ack failed for #${orderNumber}:`, err.message);
  }
}

// ── SSE connection ──
function connect() {
  console.log(`Connexion SSE à ${SERVER_URL}...`);
  const es = new EventSource(`${SERVER_URL}/api/orders/stream`);

  es.addEventListener("connected", () => {
    console.log("SSE connecté. En attente de commandes...");
  });

  es.addEventListener("order-new", async (e) => {
    const order = JSON.parse(e.data);
    console.log(`Nouvelle commande #${order.order_number} — ${order.student_name}`);

    // Fetch full order details (for localisation)
    let fullOrder = order;
    try {
      const res = await fetch(`${SERVER_URL}/api/orders/${order.order_number}`);
      if (res.ok) fullOrder = await res.json();
    } catch {
      // Use SSE data as fallback
    }

    try {
      await printReceipt(fullOrder);
      console.log(`  Reçu imprimé pour #${order.order_number}`);
      await ackPrint(order.order_number);
      console.log(`  Status → en préparation`);
    } catch (err) {
      console.error(`  Erreur impression #${order.order_number}:`, err.message);
    }
  });

  es.onerror = (err) => {
    console.error("SSE erreur, reconnexion...");
  };
}

connect();
console.log("Client d'impression Magasin TGE démarré.");
