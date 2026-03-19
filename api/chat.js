import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// 1. Inicializace Firebase (ošetřeno proti pádům)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  } catch (error) {
    console.error("Firebase se nepodařilo nahodit:", error.message);
  }
}

const db = admin.firestore();

// 2. Načtení systémového promptu
let systemPrompt = "Jsi užitečný asistent pro projekt LearningTriangle. Odpovídej česky.";
try {
  const promptPath = path.join(process.cwd(), "prompt.md");
  if (fs.existsSync(promptPath)) {
    systemPrompt = fs.readFileSync(promptPath, "utf-8");
  }
} catch (e) {
  console.warn("Prompt.md nenalezen, jedu na defaultu.");
}

export default async function handler(req, res) {
  // CORS - aby ti to prohlížeč nezablokoval
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Použij POST." });

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!message) return res.status(400).json({ error: "Zpráva chybí." });
  if (!apiKey) return res.status(500).json({ error: "Chybí GEMINI_API_KEY ve Vercelu." });

  try {
    // 3. Logování uživatele do Firebase (běží na pozadí)
    const ip = req.headers["x-forwarded-for"] || "unknown";
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: ip
    }).catch(e => console.error("Log error user:", e.message));

    // 4. Volání Gemini přes SDK (tohle řeší tu tvou 404 chybu)
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Používáme název modelu, který SDK 100% zná
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt 
    });

    const result = await model.generateContent(message);
    const response = await result.response;
    const aiReply = response.text();

    // 5. Logování bota do Firebase
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    }).catch(e => console.error("Log error bot:", e.message));

    // Poslání odpovědi zpět na frontend
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("=== CHYBA PŘI GENEROVÁNÍ ===");
    console.error(error);

    // Pokud je chyba 404 nebo 400, zkusíme poslat detailnější info
    return res.status(500).json({ 
      error: "Gemini error", 
      details: error.message 
    });
  }
}
