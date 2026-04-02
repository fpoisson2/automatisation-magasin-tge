/**
 * Pre-compute embeddings for all inventory items.
 * Requires the embedding server to be running on port 5111.
 *
 * Usage: node generate-embeddings.js
 */

const fs = require("fs");
const path = require("path");

const EMBEDDING_URL = "http://127.0.0.1:5111/embed-documents";
const BATCH_SIZE = 256;
const INVENTORY_PATH = path.join(__dirname, "excel-to-json.json");
const OUTPUT_PATH = path.join(__dirname, "embeddings.json");

function itemToText(item) {
  const parts = [];
  if (item["No d'article"]) parts.push(`Article: ${item["No d'article"]}`);
  if (item["Description"]) parts.push(item["Description"].trim());
  if (item["Mots clés"]) parts.push(item["Mots clés"].trim());
  if (item["Fournisseur"]) parts.push(`Fournisseur: ${item["Fournisseur"].trim()}`);
  if (item["Localisation"]) parts.push(`Localisation: ${item["Localisation"].trim()}`);
  return parts.join(" | ");
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf-8"));
  console.log(`Loaded ${inventory.length} items`);

  const allEmbeddings = [];
  const totalBatches = Math.ceil(inventory.length / BATCH_SIZE);

  for (let i = 0; i < inventory.length; i += BATCH_SIZE) {
    const batch = inventory.slice(i, i + BATCH_SIZE);
    const texts = batch.map(itemToText);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(`\rBatch ${batchNum}/${totalBatches}...`);

    const res = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });

    if (!res.ok) {
      throw new Error(`Embedding server error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    allEmbeddings.push(...data.embeddings);
  }

  console.log(`\nGenerated ${allEmbeddings.length} embeddings`);

  // Save as {texts: [...], embeddings: [...]}
  const texts = inventory.map(itemToText);
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ texts, embeddings: allEmbeddings })
  );

  console.log(`Saved to ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
