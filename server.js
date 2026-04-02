require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

// ── Auth middleware ──
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  // API routes return 401, page routes redirect
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  return res.redirect("/login");
}

// ── Login page ──
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.APP_USERNAME &&
    password === process.env.APP_PASSWORD
  ) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: "Identifiants invalides" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ── Protected static files (except login.html) ──
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/app.js", requireAuth, express.static(path.join(__dirname, "public", "app.js")));

// Serve login.html assets without auth
app.use(express.static("public", { index: false }));

// ── Protected API routes ──
app.get("/api/inventory", requireAuth, (req, res) => {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "excel-to-json.json"), "utf-8")
  );
  res.json(data);
});

app.post("/api/session", requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-realtime-1.5",
          voice: "shimmer",
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI session error:", err);
      return res.status(response.status).json({ error: "Erreur OpenAI" });
    }

    const data = await response.json();
    // Only send the ephemeral client_secret, never the full API key
    res.json({ client_secret: data.client_secret });
  } catch (err) {
    console.error("Session creation failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré: http://localhost:${PORT}`);
});
