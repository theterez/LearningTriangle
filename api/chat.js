import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// 1. Bezpečná inicializace Firebase (Singleton pattern)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Oprava pro privátní klíč, aby fungoval lokálně i na Vercelu
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  } catch (error) {
    console.error("Firebase init error:", error.stack);
  }
}

const db = admin.firestore();

// 2. Načtení systémového promptu (s ošetřením chyby)
let systemPrompt = "";
try {
  systemPrompt = fs.readFileSync(path.join(process.cwd(), "prompt.md"), "utf-8");
} catch (e) {
  console.warn("Varování: prompt.md nenalezen, používám prázdný prompt.");
}

// 3. Rate limiting (v paměti - funguje, dokud server neusne)
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;
  const timestamps = (rateLimitMap.get(ip) || []).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return timestamps.length > maxRequests;
}

export default async function handler(req, res) {
  // CORS hlavičky
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metoda nepovolena" });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Zpráva je prázdná" });

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Příliš mnoho zpráv, zkus to za chvíli." });
  }

  // 4. Inicializace Gemini SDK
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Chybí API klíč na serveru" });

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Nastavení modelu včetně systémového promptu přes SDK
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: systemPrompt 
  });

  try {
    // Logování uživatele (Firestore) - asynchronně, nečekáme na to (zrychlí odezvu)
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: ip,
    }).catch(err => console.error("Firestore log error:", err));

    // 5. Samotné volání Gemini
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    });

    const response = await result.response;
    const aiReply = response.text();

    // Logování odpovědi bota
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firestore bot log error:", err));

    // Úspěšná odpověď
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("=== CHAT ERROR ===");
    console.error(error);

    // Pokud Gemini zablokuje obsah (Safety settings)
    if (error.message?.includes("SAFETY")) {
      return res.status(400).json({ error: "Obsah byl zablokován bezpečnostním filtrem." });
    }

    return res.status(500).json({
      error: "Gemini API odmítlo požadavek",
      details: error.message,
    });
  }
}
