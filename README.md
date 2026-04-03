# Magasin TGE

Système de gestion d'inventaire et de commandes pour le magasin de pièces électroniques d'un cégep.

## Fonctionnalités

**Étudiants**
- Recherche instantanée dans l'inventaire (21 000+ articles)
- Recherche hybride : mots-clés + sémantique (embeddings GPU)
- Recherche par photo : prend une photo d'un composant, l'IA l'identifie
- Panier + soumission de commandes
- Suivi en temps réel (SSE) + notifications push
- Suggestions basées sur l'historique de commandes
- PWA installable sur mobile

**Magasiniers**
- Dashboard de commandes en temps réel
- Impression automatique des reçus (Raspberry Pi + imprimante thermique)
- Passage automatique en "préparation" à l'impression
- Gestion des photos et documentation par article

## Architecture

```
Étudiant (navigateur)
    ↕ HTTPS (Cloudflare Tunnel)
Serveur Node.js (Express)
    ├── SQLite (commandes, étudiants)
    ├── Embeddings JSON (recherche sémantique)
    ├── Serveur d'embeddings Python (GPU, port 5111)
    └── OpenAI API (recherche par photo)
    ↕ SSE
Raspberry Pi (print-client)
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
cp .env.example .env  # Configurer les variables
```

### Embeddings

```bash
python3 -m venv venv
source venv/bin/activate
pip install sentence-transformers torch
python embedding-server.py &    # Démarre le serveur d'embeddings
node generate-embeddings.js     # Génère les embeddings (une fois)
```

### Démarrage

```bash
node server.js
```

Ou avec systemd :

```bash
# Copier les services
sudo cp magasin-tge.service /etc/systemd/system/
sudo cp embedding-server.service /etc/systemd/system/
sudo systemctl enable --now embedding-server magasin-tge
```

### Client d'impression (Raspberry Pi)

Voir [print-client/README.md](print-client/README.md).

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `3000` |
| `OPENAI_API_KEY` | Clé API OpenAI | requis |
| `APP_USERNAME` | Login admin | requis |
| `APP_PASSWORD` | Mot de passe admin | requis |
| `SESSION_SECRET` | Secret de session | auto-généré |
| `PRINT_TOKEN` | Token du client d'impression | optionnel |
| `EMBEDDING_URL` | URL du serveur d'embeddings | `http://127.0.0.1:5111` |

## Structure

```
├── server.js              # Serveur Express principal
├── public/
│   ├── index.html         # Interface étudiant
│   ├── app.js             # Logique frontend étudiant
│   ├── admin.html         # Dashboard magasinier
│   ├── admin.js           # Logique dashboard
│   ├── login.html         # Page de connexion admin
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service worker
├── print-client/          # Client d'impression RPi
│   ├── index.js
│   ├── package.json
│   └── README.md
├── embedding-server.py    # Serveur d'embeddings local
├── generate-embeddings.js # Génération des embeddings
└── excel-to-json.json     # Données d'inventaire
```
