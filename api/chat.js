import admin from "firebase-admin";

// Paměť pro IP limity (proti spamu)
const ipCache = new Map();

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

// MOZEK BOTA - instrukce natvrdo
const SYSTEM_PROMPT = "Jsi přátelský AI asistent pro 'Learning Triangle' (doučování MAT a ČJ). Pomáháš rodičům a žákům. Odpovídej vždy stručně, srozumitelně a CELÝMI VĚTAMI. Nikdy neutínej větu uprostřed slova nebo myšlenky.";

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
    return res.status(400).json({ reply: "Chybí zpráva nebo API klíč." });
  }

  // OCHRANA PROTI SPAMU (IP RATE LIMIT - 10 zpráv/min)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const userRequests = ipCache.get(ip) || [];
  const recentRequests = userRequests.filter(t => now - t < 60000);

  if (recentRequests.length >= 10) {
    return res.status(429).json({ reply: "Píšeš moc rychle! Počkej minutku." });
  }
  recentRequests.push(now);
  ipCache.set(ip, recentRequests);

  try {
    // LOGOVÁNÍ UŽIVATELE DO FIREBASE
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      ip: ip,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log error:", err));

    // VOLÁNÍ GEMINI API - OPRAVENÁ URL PRO ROK 2026
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${SYSTEM_PROMPT}\n\nUživatel: ${message}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000, // Zajišťuje, že věty budou celé
          topP: 0.9,
          topK: 40,
        },
      }),
    });

    const data = await response.json();

    // Pokud Google vrátí chybu (např. ten tvůj 404), vypíšeme ji přímo
    if (data.error) {
      console.error("DEBUG GOOGLE ERROR:", data.error);
      return res.status(data.error.code || 500).json({ reply: `Chyba API: ${data.error.message}` });
    }

    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Teď mě nic nenapadá, zkus to znovu.";

    // LOGOVÁNÍ BOTA DO FIREBASE
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    // FINÁLNÍ ODPOVĚĎ
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Chyba na serveru. Zkus to znovu." });
  }
}
