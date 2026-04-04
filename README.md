# Magasin TGE

Système de gestion d'inventaire et de commandes pour le magasin de pièces électroniques d'un cégep. Les étudiants cherchent et commandent en ligne, le magasinier traite les demandes à son rythme.

## Fonctionnalités

**Étudiants**
- Recherche instantanée dans l'inventaire (21 000+ articles, dédupliqués)
- Recherche hybride : mots-clés + sémantique (embeddings GPU) + synonymes français
- Recherche par photo : prend une photo d'un composant, GPT-5.4-nano l'identifie
- Panier avec contrôle de quantité, persisté en localStorage
- Soumission de commandes avec suivi en temps réel (SSE)
- Notifications push navigateur quand la commande est prête
- Suggestions "récemment emprunté" basées sur l'historique
- Historique des commandes avec recherche et pagination
- PWA installable sur mobile

**Magasiniers**
- Dashboard de commandes en temps réel avec notifications sonores
- Notifications toast sur toutes les pages admin
- Impression automatique des reçus (Raspberry Pi + imprimante thermique)
- Gestion des photos et documentation par article
- Statistiques : articles populaires, temps moyen, achalandage par heure
- Multi-utilisateurs avec rôles (admin / magasinier)

## Stack

- **Frontend** : React 19 + Vite + React Router 7
- **Backend** : Node.js / Express, routes modulaires
- **Base de données** : SQLite (better-sqlite3), sessions persistantes
- **Recherche** : embeddings locaux (multilingual-e5-small sur GPU) + mots-clés + synonymes
- **Vision** : GPT-5.4-nano pour identification par photo
- **Temps réel** : Server-Sent Events (SSE)
- **Sécurité** : Helmet, rate limiting, bcrypt, input validation
- **Infra** : Cloudflare Tunnel, systemd, gzip compression

## Architecture

```
Navigateur (React SPA)
    ↕ HTTPS (Cloudflare Tunnel)
Express API (server.js + routes/)
    ├── SQLite (commandes, étudiants, sessions, photos)
    ├── Embeddings JSON (recherche sémantique)
    ├── Serveur d'embeddings Python (GPU, port 5111)
    └── OpenAI API (recherche par photo)
    ↕ SSE
Raspberry Pi (print-client/)
    └── Imprimante thermique USB
```

## Installation

### Prérequis
- Node.js 20+
- Python 3.10+ avec GPU (pour les embeddings)
- Clé API OpenAI (pour la recherche par photo)

### Serveur

```bash
git clone https://github.com/fpoisson2/automatisation-magasin-tge
cd automatisation-magasin-tge
npm install
cd frontend && npm install && cd ..
cp .env.example .env  # Configurer les variables
```

### Frontend (build)

```bash
cd frontend && npm run build
```

### Embeddings

```bash
python3 -m venv venv
source venv/bin/activate
pip install sentence-transformers torch
python embedding-server.py &
node generate-embeddings.js
```

### Démarrage

```bash
node server.js
```

Ou avec systemd :

```bash
sudo systemctl enable --now embedding-server magasin-tge
```

### Client d'impression (Raspberry Pi)

Voir [print-client/README.md](print-client/README.md).

## Commandes

| Commande | Description |
|----------|-------------|
| `npm start` | Démarrer le serveur |
| `npm run build` | Build le frontend React |
| `npm run deploy` | Build + restart le service |
| `npm test` | Lancer les 16 tests API |
| `cd frontend && npm run dev` | Dev server avec HMR (port 5173) |

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `3000` |
| `OPENAI_API_KEY` | Clé API OpenAI | requis |
| `APP_USERNAME` | Login admin initial | requis |
| `APP_PASSWORD` | Mot de passe admin initial | requis |
| `SESSION_SECRET` | Secret de session | auto-généré |
| `PRINT_TOKEN` | Token du client d'impression | optionnel |
| `EMBEDDING_URL` | URL du serveur d'embeddings | `http://127.0.0.1:5111` |

## Structure

```
├── server.js                # Express setup, middleware, DB init
├── routes/
│   ├── search.js            # Recherche texte/photo, étudiants, fréquents
│   ├── orders.js            # SSE, commandes CRUD, admin orders, print-ack
│   └── admin.js             # Items extras, photos, users, stats
├── frontend/                # React SPA (Vite)
│   └── src/
│       ├── api.js           # Couche fetch centralisée
│       ├── hooks/           # useSSE, useCart, useAuth, useAdminNotifications
│       ├── components/      # AdminNav, Modal, Badge, ItemCard, Toasts
│       └── pages/           # StudentPage, LoginPage, Admin{Orders,Stats,Items,Users}
├── dist/                    # Build React (servi par Express)
├── tests/
│   └── api.test.js          # 16 tests API
├── print-client/            # Client d'impression RPi
├── public/
│   └── design.css           # Design system (CSS custom properties)
├── embedding-server.py      # Serveur d'embeddings local (GPU)
├── generate-embeddings.js   # Génération des embeddings
└── excel-to-json.json       # Données d'inventaire
```

## API

### Publiques
- `POST /api/search` — recherche hybride
- `POST /api/search/photo` — recherche par photo
- `POST /api/orders` — créer une commande
- `GET /api/orders/by-da/:da` — commandes d'un étudiant
- `GET /api/orders/stream?da=` — SSE temps réel
- `GET /api/health` — état du serveur

### Admin (auth requise)
- `GET /api/admin/orders` — commandes actives
- `PATCH /api/admin/orders/:id` — changer le statut
- `GET /api/admin/stats` — statistiques
- `GET/POST/DELETE /api/admin/users` — gestion utilisateurs
- `POST /api/admin/items/:no/photo` — upload photo article
