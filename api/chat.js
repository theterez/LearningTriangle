import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// 1. Inicializace Firebase (Singleton pattern s ošetřením chyb)
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
    console.error("Firebase init fail:", error.message);
  }
}

const db = admin.firestore();

// 2. Načtení systémového promptu (s fallbackem, aby to nespadlo)
let systemPrompt = "Jsi užitečný asistent pro projekt LearningTriangle. Odpovídej česky.";
try {
  const promptPath = path.join(process.cwd(), "prompt.md");
  if (fs.existsSync(promptPath)) {
    systemPrompt = fs.readFileSync(promptPath, "utf-8");
  }
} catch (e) {
  console.warn("Prompt.md nenalezen, používám default.");
}

export default async function handler(req, res) {
  // CORS hlavičky (aby tě prohlížeč neměl za nepřítele)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metoda nepovolena" });

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!message) return res.status(400).json({ error: "Zpráva je prázdná" });
  if (!apiKey) return res.status(500).json({ error: "Chybí API klíč ve Vercelu" });

  try {
    // 3. Logování uživatele (Firestore)
    const ip = req.headers["x-forwarded-for"] || "unknown";
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: ip,
    }).catch(err => console.error("Firestore user log error:", err.message));

    // 4. Inicializace Gemini s opraveným modelem
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Změna na gemini-1.5-flash-latest pro vyřešení té 404 chyby
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash-latest",
      systemInstruction: systemPrompt 
    });

    // 5. Generování odpovědi
    const result = await model.generateContent(message);
    const response = await result.response;
    const aiReply = response.text();

    // 6. Logování bota (Firestore)
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firestore bot log error:", err.message));

    // Úspěšná odpověď zpět uživateli
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("=== API ERROR DETAILS ===");
    console.error(error);

    return res.status(500).json({
      error: "Gemini API problém",
      details: error.message,
    });
  }
}
