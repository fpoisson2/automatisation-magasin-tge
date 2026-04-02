"""
Local embedding server using EmbeddingGemma-300M on GPU.
Provides a REST API for computing embeddings.
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from sentence_transformers import SentenceTransformer

MODEL_NAME = "intfloat/multilingual-e5-small"
PORT = int(os.environ.get("EMBEDDING_PORT", 5111))

print(f"Loading {MODEL_NAME}...")
model = SentenceTransformer(MODEL_NAME)
print(f"Model loaded on {model.device}. Server starting on port {PORT}...")


class EmbeddingHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        if self.path == "/embed-query":
            texts = body.get("texts", [])
            if isinstance(texts, str):
                texts = [texts]
            # E5 models need "query: " prefix for queries
            texts = [f"query: {t}" for t in texts]
            embeddings = model.encode(texts, normalize_embeddings=True).tolist()
            self._respond({"embeddings": embeddings})

        elif self.path == "/embed-documents":
            texts = body.get("texts", [])
            if isinstance(texts, str):
                texts = [texts]
            # E5 models need "passage: " prefix for documents
            texts = [f"passage: {t}" for t in texts]
            embeddings = model.encode(texts, normalize_embeddings=True).tolist()
            self._respond({"embeddings": embeddings})

        elif self.path == "/health":
            self._respond({"status": "ok", "model": MODEL_NAME})

        else:
            self._respond({"error": "Not found"}, 404)

    def do_GET(self):
        if self.path == "/health":
            self._respond({"status": "ok", "model": MODEL_NAME})
        else:
            self._respond({"error": "Not found"}, 404)

    def _respond(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass  # Quiet logs


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), EmbeddingHandler)
    print(f"Embedding server ready at http://127.0.0.1:{PORT}")
    server.serve_forever()
