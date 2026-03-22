import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ipCache = new Map();

let PROMPT_CONTENT = "";
let SYSTEM_PROMPT = "";

function loadPromptFile() {
  try {
    const promptPath = path.join(__dirname, "../prompt.md");
    PROMPT_CONTENT = fs.readFileSync(promptPath, "utf8");
    // STRIKTNÍ INSTRUKCE PRO FORMÁT
    SYSTEM_PROMPT = `${PROMPT_CONTENT}\n\nSTRIKTNÍ PRAVIDLA: Odpovídej jako člověk v chatu, stručně (max 2-3 věty). Nepoužívej ŽÁDNÉ hvězdičky (**), mřížky (#), odrážky ani seznamy. Piš pouze čistý text.`;
    console.log("✅ Prompt file loaded successfully");
    return true;
  } catch (err) {
    console.warn("⚠️ Could not load prompt.md file:", err.message);
    SYSTEM_PROMPT = `Jsi asistent Learning Triangle. Odpovídej stručně, bez hvězdiček a mřížek. Kontakt: +420 722 207 321.`;
    return false;
  }
}

loadPromptFile();

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
  } catch (e) { 
    console.error("Firebase fail:", e); 
  }
}

const db = admin.firestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!message || !apiKey) {
    return res.status(200).json({ reply: "Chyba konfigurace. Zkuste to později." });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const userRequests = ipCache.get(ip) || [];
  const recentRequests = userRequests.filter(t => now - t < 60000);

  if (recentRequests.length >= 10) {
    return res.status(200).json({ reply: "Píšete moc rychle! Počkejte prosím chvilku." });
  }
  recentRequests.push(now);
  ipCache.set(ip, recentRequests);

  try {
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      ip: ip,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log error:", err));

    // Používáme stabilní Flash model, který je ideální pro chaty
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ 
          role: "user", 
          parts: [{ text: `KONTEXT:\n${SYSTEM_PROMPT}\n\nDOTAZ UŽIVATELE: ${message}` }] 
        }],
        generationConfig: {
          temperature: 0.4,     // Sníženo pro maximální věcnost
          maxOutputTokens: 120, // TVRDÝ LIMIT DÉLKY (cca 2 věty)
          topP: 0.8,
        },
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("API ERROR:", JSON.stringify(data.error));
      return res.status(200).json({ reply: "Omlouvám se, mám technický výpadek. Zkuste to za chvíli!" });
    }

    let aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Teď mě nic nenapadá, zkuste se zeptat jinak.";

    // POJIŠTĚNÍ: Odstranění všech formátovacích znaků (hvězdičky, mřížky, odrážky)
    aiReply = aiReply.replace(/[*#_>]/g, "").replace(/^\s*[-+]\s+/gm, "").trim();

    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("CRITICAL ERROR:", error);
    return res.status(200).json({ reply: "Došlo k chybě připojení. Zkuste to prosím znovu." });
  }
}
