import admin from "firebase-admin";

// Paměť pro IP limity (vydrží po dobu běhu instance na Vercelu)
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
const SYSTEM_PROMPT = "Jsi přátelský AI asistent pro 'Learning Triangle' (doučování MAT a ČJ). Pomáháš rodičům a žákům. Odpovídej vždy stručně, srozumitelně a CELÝMI VĚTAMI. Nikdy neutínej větu uprostřed slova nebo myšlenky.";

export default async function handler(req, res) {
  // 1. POVINNÉ NASTAVENÍ HLAVIČEK (CORS)
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

  // 2. OCHRANA PROTI SPAMU (IP RATE LIMIT)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 60000; // 1 minuta
  const maxPerWindow = 5; // Max 5 zpráv za minutu

  const userRequests = ipCache.get(ip) || [];
  const recentRequests = userRequests.filter(timestamp => now - timestamp < windowMs);

  if (recentRequests.length >= maxPerWindow) {
    return res.status(429).json({ reply: "Píšeš moc rychle! Počkej minutku, než pošleš další zprávu." });
  }

  recentRequests.push(now);
  ipCache.set(ip, recentRequests);

  try {
    // 3. LOGOVÁNÍ UŽIVATELE DO FIREBASE
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      ip: ip,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log user error:", err));

    // 4. VOLÁNÍ GEMINI API (S POŘÁDNÝM LIMITEM SLOV)
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
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
            maxOutputTokens: 1000, // Aby to neřezalo věty!
            topP: 0.9,
            topK: 40,
          },
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("Gemini API Error:", data.error);
      return res.status(500).json({ reply: "Zkus to prosím znovu za chvilku (API Limit)." });
    }

    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Teď mě nic nenapadá, zkus to znovu.";

    // 5. LOGOVÁNÍ BOTA DO FIREBASE
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log bot error:", err));

    // 6. FINÁLNÍ ODPOVĚĎ
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Chyba na serveru. Zkus to znovu." });
  }
}
