# 🎓 Learning Triangle - Doučovací Platforma s AI Chatbotem

Plně funkční webová stránka s AI chatbotem pro doučování v Havlíčkově Brodě a Jihlavě.

---

## 📋 Požadavky

- **Node.js** (verze 16+) - [Stáhnout](https://nodejs.org)
- **npm** (součást Node.js)
- **GEMINI API Key** - [Získat zdarma](https://aistudio.google.com/app/apikey)

---

## 🚀 Instalace a spuštění

### 1️⃣ Klonování / Stažení projektu
```bash
cd your-project-folder
```

### 2️⃣ Instalace balíčků
```bash
npm install
```

### 3️⃣ Nastavení API klíče

Vytvoř soubor `.env` v kořenu projektu:

```bash
# Zkopíruj z .env.example
cp .env.example .env
```

Pak otevři `.env` a vepíš svůj **Gemini API Key**:
```
GEMINI_API_KEY=sk-1234567890abcdefghijklmnop
```

📌 **Jak získat Gemini API Key?**
1. Jdi na https://aistudio.google.com/app/apikey
2. Klikni "Get API Key"
3. Zvol "Create API key"
4. Zkopíruj klíč a vepíš do `.env`

### 4️⃣ Spuštění serveru

**Lokální vývoj:**
```bash
npm run dev
```

**Nebo normální start:**
```bash
npm start
```

Pak otevři v prohlížeči:
```
http://localhost:3000
```

---

## 🤖 Chatbot - První test

1. Otevři **http://localhost:3000** v prohlížeči
2. Najdi chatovací okno
3. Napiš: "Ahoj, co je Learning Triangle?"
4. AI by měla odpovědět s informacemi z `prompt.md`

---

## 📁 Struktura projektu

```
LearningTriangle/
├── assets/
│   ├── images/          # Obrázky (logo, fotky, pozadí)
│   └── fonts/           # Fonty (Montserrat)
├── api/
│   ├── chat.js          # Vercel serverless (pro production)
│   └── firebase.js      # Firebase konfigurace
├── index.html           # Hlavní stránka
├── *.html               # Ostatní stránky
├── styles.css           # Globální styly
├── *.css                # CSS pro jednotlivé stránky
├── script.js            # Frontend JavaScript
├── server.js            # Express dev server (lokální)
├── package.json         # npm konfigurace
├── vercel.json          # Vercel deployment config
├── prompt.md            # AI znalostní báze
└── .env.example         # Template pro environment variables
```

---

## 🌐 Deploy na Vercel

### Lokálně máš vše hotovo. Pro live nasazení:

```bash
# Instalace Vercel CLI
npm install -g vercel

# Deploy
vercel
```

Vercel automaticky:
- ✅ Nasadí frontend (statické soubory)
- ✅ Nasadí backend (api/chat.js jako serverless funkci)
- ✅ Nakonfiguruje environment variables

---

## 🔧 Dostupné příkazy npm

```bash
npm run dev         # Spustit dev server na :3000
npm start          # Spustit server
npm test           # Spustit testy (zatím není)
```

---

## 🧠 Jak funguje AI?

1. **Frontend** (`script.js`) pošle zprávu na `/api/chat`
2. **Server** (`server.js` nebo `api/chat.js` na Vercelu) přijme zprávu
3. **Server** přečte znalostní bázi z `prompt.md`
4. **Server** pošle zprávu + prompt do **Google Gemini API**
5. **Gemini** vrátí odpověď
6. **Server** vrátí odpověď frontendů
7. **Frontend** zobrazí odpověď v chatu

---

## ⚙️ Environment Variables

Ve stejné složce vytvoř `.env` soubor (na základě `.env.example`):

```env
# POVINNÉ
GEMINI_API_KEY=sk_xxxxx  # Tvůj Google Gemini API Key

# VOLITELNÉ (jen pro Vercel s Firebase logging)
FIREBASE_PROJECT_ID=xxx
FIREBASE_CLIENT_EMAIL=xxx
FIREBASE_PRIVATE_KEY=xxx
FIREBASE_DATABASE_URL=xxx
```

---

## 🐛 Troubleshooting

### "Cannot find module 'express'"
```bash
npm install
```

### "GEMINI_API_KEY is not set"
- Zkontroluj, jestli máš v `.env` souboru `GEMINI_API_KEY=...`
- Zkontroluj, jestli je to správný klíč z https://aistudio.google.com/app/apikey

### ChatBot nereaguje
1. Otevři **http://localhost:3000/health** - měli by sis vidět status
2. Kontroluj konzoli (`F12` → Console) na frontend chybách
3. Kontroluj terminal, kde je server spuštěn

### "Module not found: prompt.md"
- Ujisti se, že `prompt.md` je v kořenu projektu (vedle `server.js`)

---

## 📞 Kontakt a Podpora

- **Learning Triangle**: +420 722 207 321
- **Email**: info@learningtriangle.cz
- **Web**: https://learningtriangle.cz

---

## 📝 Licence

ISC

---

**Hotovo? Začínej s `npm run dev` a užívej si! 🚀**
