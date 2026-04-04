#!/bin/bash
# Emergency recovery script — restarts all services
echo "$(date -Iseconds) Starting recovery..."

systemctl restart embedding-server
echo "Embedding server restarting..."
sleep 5

# Wait for embedding server
for i in $(seq 1 12); do
  if curl -sf http://127.0.0.1:5111/health > /dev/null 2>&1; then
    echo "Embedding server OK"
    break
  fi
  echo "Waiting for embedding server... ($i)"
  sleep 5
done

systemctl restart magasin-tge
echo "Magasin TGE restarting..."
sleep 3

# Verify
if curl -sf http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
  echo "$(date -Iseconds) Recovery complete — all services OK"
else
  echo "$(date -Iseconds) WARNING: Health check failed after recovery"
  exit 1
fi
