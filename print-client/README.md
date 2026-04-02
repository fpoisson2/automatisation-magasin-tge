# Client d'impression — Magasin TGE

Script Node.js pour Raspberry Pi. Se connecte au serveur via SSE, imprime automatiquement les commandes sur une imprimante thermique USB 80mm.

## Installation

```bash
# Sur le Raspberry Pi
sudo apt update && sudo apt install -y nodejs npm libusb-1.0-0-dev

git clone <repo-url>
cd print-client
npm install
cp .env.example .env
```

## Configuration

Éditez `.env` :

```
SERVER_URL=https://votre-tunnel.trycloudflare.com
PRINT_TOKEN=le-meme-token-que-dans-le-serveur
PRINTER_VID=0x0416
PRINTER_PID=0x5011
```

Pour trouver le VID:PID de votre imprimante :
```bash
lsusb
# Exemple: Bus 001 Device 004: ID 0416:5011 Generic USB Printer
```

## Permissions USB

```bash
# Créer une règle udev pour accéder à l'imprimante sans root
sudo tee /etc/udev/rules.d/99-usb-printer.rules << 'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="0416", ATTR{idProduct}=="5011", MODE="0666"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger
```

## Lancement

```bash
node index.js
```

## Démarrage automatique (systemd)

```bash
sudo tee /etc/systemd/system/magasin-print.service << 'EOF'
[Unit]
Description=Magasin TGE Print Client
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/pi/print-client
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
User=pi

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now magasin-print.service
```
