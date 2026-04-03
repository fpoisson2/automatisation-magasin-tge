# CLAUDE.md

## Projet
Magasin TGE — système d'inventaire et de commandes pour un magasin de pièces électroniques dans un cégep. Serveur distant accessible via Cloudflare Tunnel.

## Stack technique
- **Backend** : Node.js / Express, SQLite (better-sqlite3), pas d'ORM
- **Frontend** : Vanilla JS, CSS inline dans les HTML, pas de framework
- **Recherche** : hybride (mots-clés + cosine similarity sur embeddings pré-calculés)
- **Embeddings** : serveur Python local (sentence-transformers, multilingual-e5-small) sur GPU, port 5111
- **Temps réel** : SSE (Server-Sent Events), pas de WebSocket
- **IA** : GPT-5.4-nano pour la recherche par photo (vision), paramètre `max_completion_tokens` (pas `max_tokens`)
- **Impression** : client Node.js séparé sur Raspberry Pi, ESC/POS via USB
- **PWA** : manifest.json + service worker pour installation mobile

## Commandes
```bash
npm start              # Démarrer le serveur
node generate-embeddings.js  # Régénérer les embeddings après changement d'inventaire
systemctl restart magasin-tge embedding-server  # Redémarrer les services
```

## Architecture clé
- `server.js` : tout le backend (auth, recherche, commandes, SSE, uploads, API vision)
- `public/app.js` : toute la logique frontend étudiant
- `public/admin.js` : dashboard magasinier
- `print-client/` : client d'impression autonome pour RPi
- Les embeddings sont indexés par position — ne pas réordonner `inventoryData` sans regénérer

## Conventions
- Les étudiants n'ont pas de login, juste un numéro de DA (5-9 chiffres)
- L'admin utilise un login unique (APP_USERNAME/APP_PASSWORD dans .env)
- Les routes `/api/search`, `/api/orders`, `/api/students` sont publiques (rate-limited)
- Les routes `/api/admin/*` et `/admin` requièrent l'authentification session
- Le PRINT_TOKEN authentifie le client d'impression RPi
- Les résultats de recherche sont dédupliqués par description et filtrés (dispo > 0, pas de garbage)
- `deduplicateResults()` et `getOrderWithItems()` sont les helpers principaux côté serveur

## Flux des commandes
1. Étudiant soumet → status `pending`
2. RPi imprime le reçu → appelle `/api/print-ack` → status `preparing` → notification SSE
3. Magasinier clique "Prête" sur le dashboard → status `ready` → notification push à l'étudiant
4. Pas de status "remise" — `ready` est le status final visible

## Base de données (SQLite)
Tables : `students`, `orders`, `order_items`, `item_extras`
- `item_extras` : photos et liens doc par article (uploadés par l'admin)
- Les commandes terminées ont status `ready`, annulées `cancelled`

## Points d'attention
- Le serveur est distant (cloud), l'imprimante est locale (RPi) — communication via SSE + token
- `express-session` avec MemoryStore — suffisant pour un seul process, pas scalable
- Le fichier `embeddings.json` fait ~163 MB, exclu du git
- Les icônes PWA ont les couleurs décalées (hue shift) par rapport au logo original
