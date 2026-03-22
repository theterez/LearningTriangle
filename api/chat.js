import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paměť pro IP limity (proti spamu)
const ipCache = new Map();

// Načteníí prompt.md souboru
let PROMPT_CONTENT = "";
let SYSTEM_PROMPT = "";

function loadPromptFile() {
  try {
    const promptPath = path.join(__dirname, "../prompt.md");
    PROMPT_CONTENT = fs.readFileSync(promptPath, "utf8");
    // TADY JE TA ZMĚNA: Přidán striktní limit na délku
    SYSTEM_PROMPT = `${PROMPT_CONTENT}\n\nSTRIKTNÍ PRAVIDLO: Tvá odpověď nesmí být delší než 300 znaků. Buď stručný a věcný.`;
    console.log("✅ Prompt file loaded successfully");
    return true;
  } catch (err) {
    console.warn("⚠️ Could not load prompt.md file:", err.message);
    // Fallback systém prompt s limitem
    SYSTEM_PROMPT = `Jsi přátelský AI asistent pro Learning Triangle. Pomáháš s dotazy ohledně doučování. 
Kontakt: +420 722 207 321. Odpovídej stručně, maximálně do 300 znaků.`;
    return false;
  }
}

// Načtení promptu při startu
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
  // CORS nastavení
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

  // OCHRANA PROTI SPAMU (IP RATE LIMIT - 10 zpráv/min)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const userRequests = ipCache.get(ip) || [];
  const recentRequests = userRequests.filter(t => now - t < 60000);

  if (recentRequests.length >= 10) {
    return res.status(200).json({ reply: "Píšete moc rychle! Počkejte prosím chvilku, než pošlete další zprávu." });
  }
  recentRequests.push(now);
  ipCache.set(ip, recentRequests);

  try {
    // 1. LOGOVÁNÍ UŽIVATELE DO FIREBASE
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      ip: ip,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log error:", err));

    // 2. VOLÁNÍ GEMINI API S TVOJI FUNKČNÍ URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nUživatel: ${message}` }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
          topP: 0.9,
          topK: 40,
        },
      }),
    });

    const data = await response.json();

    // --- TADY JE TA ZMĚNA PRO BEZPEČNOST A PROFI VZHLED ---
    if (data.error) {
      // Technickou chybu uvidíš jen ty v logách Vercelu
      console.error("GOOGLE API ERROR LOG:", JSON.stringify(data.error));

      // Pokud je to limit (429), nebo jakákoliv jiná chyba (404, 500)
      // Vrátíme uživateli slušnou zprávu místo kódu
      return res.status(200).json({ 
        reply: "Omlouvám se, zrovna mám v doučování pauzu nebo technický výpadek. Zkuste mi prosím napsat znovu za chvíli!" 
      });
    }

    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Teď mě nic nenapadá, zkuste se zeptat jinak.";

    // 3. LOGOVÁNÍ BOTA DO FIREBASE
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    // 4. FINÁLNÍ ODPOVĚĎ
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("CRITICAL SERVER ERROR:", error);
    return res.status(200).json({ reply: "Omlouvám se, došlo k chybě připojení. Zkuste to prosím znovu." });
  }
}
