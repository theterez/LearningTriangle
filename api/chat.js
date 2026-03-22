import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paměť pro IP limity (proti spamu)
const ipCache = new Map();

// Načtení promptu
let PROMPT_CONTENT = "";
let SYSTEM_PROMPT = "";

function loadPromptFile() {
  try {
    const promptPath = path.join(__dirname, "../prompt.md");
    PROMPT_CONTENT = fs.readFileSync(promptPath, "utf8");
    // Přidáváme striktní instrukci o formátu přímo k promptu
    SYSTEM_PROMPT = `${PROMPT_CONTENT}\n\nSTRIKTNÍ PRAVIDLA: Odpovídej stručně (max 2-3 věty). Nepoužívej ŽÁDNÉ formátování jako **tučné**, # nadpisy, seznamy nebo odrážky. Piš jako člověk v chatu.`;
    console.log("✅ Prompt file loaded successfully");
    return true;
  } catch (err) {
    console.warn("⚠️ Could not load prompt.md file:", err.message);
    SYSTEM_PROMPT = `Jsi přátelský asistent Learning Triangle. Odpovídej stručně bez formátování (hvězdiček, mřížek). Kontakt: +420 722 207 321.`;
    return false;
  }
}

loadPromptFile();

// Inicializace Firebase
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
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!message || !apiKey) {
    return res.status(200).json({ reply: "Chyba konfigurace na serveru." });
  }

  // OCHRANA PROTI SPAMU (10 zpráv/min)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const userRequests = ipCache.get(ip) || [];
  const recentRequests = userRequests.filter(t => now - t < 60000);

  if (recentRequests.length >= 10) {
    return res.status(200).json({ reply: "Píšete moc rychle! Zkuste to prosím za minutku." });
  }
  recentRequests.push(now);
  ipCache.set(ip, recentRequests);

  try {
    // 1. Logování do Firebase
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      ip: ip,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log error:", err));

    // 2. Volání Gemini API (používáme stabilní flash model)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ 
          role: "user", 
          parts: [{ text: `KONTEXT: ${SYSTEM_PROMPT}\n\nUŽIVATEL: ${message}` }] 
        }],
        generationConfig: {
          temperature: 0.5,     // Nižší teplota = méně vymýšlení nesmyslů
          maxOutputTokens: 150, // Krátká odpověď (cca 2-3 věty)
          topP: 0.8,
        },
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("GOOGLE API ERROR:", JSON.stringify(data.error));
      return res.status(200).json({ 
        reply: "Mám zrovna krátkou pauzu. Zkuste mi prosím napsat za chvilku!" 
      });
    }

    // Vyčištění odpovědi od případných zbylých Markdown znaků
    let aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Teď mi vypadlo spojení, zkuste to prosím znovu.";
    aiReply = aiReply.replace(/[\*#_>]/g, "").trim(); // Odstraní hvězdičky, mřížky, podtržítka

    // 3. Logování odpovědi bota
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("CRITICAL ERROR:", error);
    return res.status(200).json({ reply: "Omlouvám se, něco se pokazilo. Zkuste to znovu." });
  }
}
