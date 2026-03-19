import admin from "firebase-admin";

// 1. Inicializace Firebase (pokud ještě neběží)
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

// 2. DEFINICE PROMPTU (Tady dáváme botovi mozek, aby věděl, že nesmí končit v půlce)
const SYSTEM_PROMPT = "Jsi přátelský AI asistent pro 'Learning Triangle' (doučování MAT a ČJ). Pomáháš rodičům a žákům. Odpovídej vždy stručně, srozumitelně a CELÝMI VĚTAMI. Nikdy neutínej větu uprostřed slova nebo myšlenky. Pokud je odpověď delší, rozděl ji do krátkých bodů.";

export default async function handler(req, res) {
  // CORS a metody
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

  try {
    // A. Logování uživatele do databáze (běží na pozadí)
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log user error:", err));

    // B. Volání Gemini API
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
              parts: [{ text: `${SYSTEM_PROMPT}\n\nUživatel píše: ${message}` }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000, // ZVÝŠENO: Aby mohl bot ty věty v klidu dokončit
            topP: 0.9,
            topK: 40,
          },
        }),
      }
    );

    const data = await response.json();

    // C. Ošetření chyb z API (např. limity požadavků)
    if (data.error) {
      console.error("Gemini API Error:", data.error);
      return res.status(500).json({ reply: "Dostal jsem se na limit požadavků. Zkus to prosím znovu za chvilku." });
    }

    // D. Vytažení odpovědi
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Teď mi to trochu nemyslí, zkus se zeptat znovu.";

    // E. Logování bota do databáze (běží na pozadí)
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Firebase log bot error:", err));

    // F. Odeslání odpovědi zpět do chatu
    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("Chyba serveru:", error);
    return res.status(500).json({ reply: "Chyba spojení. Zkus to prosím znovu." });
  }
}
