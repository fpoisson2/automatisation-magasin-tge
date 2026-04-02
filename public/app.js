// ── State ──
let pc = null;
let dc = null;
let isConnected = false;
let searchTimer = null;
let searchController = null;
let voicePanelOpen = false;

const micBtn = document.getElementById("mic-btn");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const resultsEl = document.getElementById("results");
const resultCount = document.getElementById("result-count");
const emptyState = document.getElementById("empty-state");
const remoteAudio = document.getElementById("remote-audio");
const voicePanel = document.getElementById("voice-panel");
const searchInput = document.getElementById("search-input");

// ── Live search ──
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();

  if (searchTimer) clearTimeout(searchTimer);
  if (searchController) searchController.abort();

  if (!query) {
    resultsEl.innerHTML = "";
    resultCount.style.display = "none";
    emptyState.style.display = "";
    return;
  }

  searchTimer = setTimeout(() => liveSearch(query), 120);
});

async function liveSearch(query) {
  searchController = new AbortController();
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: searchController.signal,
    });
    if (!res.ok) return;
    const results = await res.json();
    displayResults(results);
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
}

// ── UI helpers ──
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function addTranscript(role, text) {
  const span = document.createElement("div");
  span.className = role === "user" ? "transcript-user" : "transcript-assistant";
  span.textContent = `${role === "user" ? "Vous" : "Assistant"}: ${text}`;
  transcriptEl.appendChild(span);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function displayResults(items) {
  resultsEl.innerHTML = "";
  emptyState.style.display = "none";

  if (!items.length) {
    resultCount.style.display = "block";
    resultCount.textContent = "Aucun article trouvé";
    return;
  }

  resultCount.style.display = "block";
  resultCount.textContent = `${items.length} résultat${items.length > 1 ? "s" : ""}`;

  items.forEach((item) => {
    const dispo = parseInt(item["Disponible"]) || 0;
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="article-no">#${item["No d'article"]}</div>
      <div class="description">${item["Description"]}</div>
      <div class="meta">
        <span>Qté: <strong>${item["Quantité"]}</strong></span>
        <span class="${dispo === 0 ? "out-of-stock" : ""}">Dispo: <strong>${item["Disponible"]}</strong></span>
        <span>Prix: <strong>${item["Prix"]}$</strong></span>
        ${item["Localisation"] ? `<span>Loc: <strong>${item["Localisation"]}</strong></span>` : ""}
        ${item["État"] ? `<span>État: <strong>${item["État"]}</strong></span>` : ""}
        ${item["Fournisseur"] ? `<span>Fourn: <strong>${item["Fournisseur"]}</strong></span>` : ""}
      </div>
    `;
    resultsEl.appendChild(card);
  });
}

// ── Voice FAB: toggle panel ──
micBtn.addEventListener("click", async () => {
  if (isConnected) {
    disconnect();
    return;
  }

  if (!voicePanelOpen) {
    voicePanel.classList.add("open");
    voicePanelOpen = true;
  }

  await connect();
});

// Close panel when clicking outside
document.addEventListener("click", (e) => {
  if (voicePanelOpen && !e.target.closest("#voice-fab")) {
    if (isConnected) disconnect();
    voicePanel.classList.remove("open");
    voicePanelOpen = false;
  }
});

// ── Hybrid search for voice mode ──
async function searchInventory(query) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) return [];
  return await res.json();
}

// ── Connect to OpenAI Realtime ──
async function connect() {
  try {
    setStatus("Connexion en cours...");

    const sessionRes = await fetch("/api/session", { method: "POST" });
    if (!sessionRes.ok) throw new Error("Impossible de créer la session");
    const sessionData = await sessionRes.json();
    const ephemeralKey = sessionData.client_secret.value;

    pc = new RTCPeerConnection();

    pc.ontrack = (e) => {
      remoteAudio.srcObject = e.streams[0];
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(stream.getTracks()[0]);

    dc = pc.createDataChannel("oai-events");
    setupDataChannel();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-realtime-1.5",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!sdpRes.ok) throw new Error("Échec SDP");

    const answer = await sdpRes.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    isConnected = true;
    micBtn.classList.add("active");
    setStatus("Connecté - Parlez!", "connected");
  } catch (err) {
    console.error(err);
    setStatus(`Erreur: ${err.message}`, "error");
    disconnect();
  }
}

function disconnect() {
  if (dc) dc.close();
  if (pc) {
    pc.getSenders().forEach((s) => {
      if (s.track) s.track.stop();
    });
    pc.close();
  }
  pc = null;
  dc = null;
  isConnected = false;
  micBtn.classList.remove("active");
  setStatus("Cliquez pour parler");
}

// ── Data channel events ──
function setupDataChannel() {
  dc.onopen = () => {
    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: `Tu es l'assistant vocal du Magasin TGE, un magasin de pièces électroniques dans un cégep (collège).
Tu es très amical, chaleureux et enthousiaste. Tu tutoies les gens. Tu utilises un ton décontracté et positif.
Quand quelqu'un te salue, accueille-le chaleureusement.

Ton rôle PRINCIPAL est d'aider les gens à trouver des articles dans l'inventaire du magasin.

RÈGLE IMPORTANTE: Dès qu'un utilisateur mentionne un objet, un composant, une pièce ou quoi que ce soit qui pourrait être dans l'inventaire, tu DOIS IMMÉDIATEMENT appeler la fonction "search_inventory" AVANT de répondre. Ne pose PAS de questions de clarification - cherche d'abord, pose des questions ensuite si nécessaire.

Exemples:
- "un fer à souder" → appelle search_inventory("fer souder")
- "est-ce que vous avez des résistances?" → appelle search_inventory("résistance")
- "j'ai besoin d'un Arduino" → appelle search_inventory("arduino")
- "câble HDMI" → appelle search_inventory("HDMI câble")

Après avoir reçu les résultats:
1. Résume les résultats de façon concise et amicale (mentionne le numéro d'article et la description)
2. Si la quantité disponible est 0, mentionne-le
3. Si rien n'est trouvé, suggère d'essayer avec d'autres mots-clés

Tu parles en français québécois naturel. Sois bref dans tes réponses vocales.`,
        tools: [
          {
            type: "function",
            name: "search_inventory",
            description:
              "Recherche des articles dans l'inventaire du magasin TGE par mots-clés, numéro d'article ou description.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "Les mots-clés de recherche (ex: 'résistance 10k', 'condensateur', 'arduino', numéro d'article, etc.)",
                },
              },
              required: ["query"],
            },
          },
        ],
        tool_choice: "auto",
        input_audio_transcription: {
          model: "whisper-1",
        },
      },
    };

    dc.send(JSON.stringify(sessionUpdate));
  };

  dc.onmessage = (e) => {
    const event = JSON.parse(e.data);

    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          addTranscript("user", event.transcript);
        }
        break;

      case "response.audio_transcript.done":
        if (event.transcript) {
          addTranscript("assistant", event.transcript);
        }
        break;

      case "response.function_call_arguments.done":
        handleFunctionCall(event);
        break;

      case "error":
        console.error("Realtime error:", event.error);
        setStatus(`Erreur: ${event.error?.message || "inconnue"}`, "error");
        break;
    }
  };

  dc.onclose = () => {
    if (isConnected) disconnect();
  };
}

// ── Handle function calls ──
async function handleFunctionCall(event) {
  if (event.name === "search_inventory") {
    const args = JSON.parse(event.arguments);
    const results = await searchInventory(args.query);

    displayResults(results);

    const summary = results.slice(0, 5).map((item) => ({
      no: item["No d'article"],
      description: item["Description"],
      quantite: item["Disponible"],
      prix: item["Prix"],
      localisation: item["Localisation"] || "N/A",
    }));

    const output = {
      total_found: results.length,
      showing: summary.length,
      items: summary,
    };

    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: event.call_id,
          output: JSON.stringify(output),
        },
      })
    );

    dc.send(JSON.stringify({ type: "response.create" }));
  }
}
