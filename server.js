const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione Telegram
const TELEGRAM_API_TOKEN = "7281815713:AAFl5eaCu5VN2RH4VPuh4bcCCzOap4MKyPk";
const CHAT_ID = "1105444796"; // Il tuo chat_id

// Middleware per il parsing di URL e JSON
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Funzione per sfuggire i caratteri Markdown
function escapeMarkdown(text) {
  return text
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/\\/g, "\\\\")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}

// Route POST e GET per il Postback
app.all("/postback", async (req, res) => {
  const method = req.method;

  // Log di debug per monitorare le richieste
  console.log("Metodo ricevuto:", method);
  console.log("Parametri ricevuti:", req.query);

  // Estrazione dei parametri
  const { userID, transactionID, revenue, currencyAmount, hash, ip, type } = req.query;

  // Controllo parametri obbligatori
  if (!userID || !transactionID || !currencyAmount) {
    res.status(400).json({
      error: "Parametri obbligatori mancanti: userID, transactionID o currencyAmount."
    });
    return;
  }

  // Messaggio da inviare a Telegram
  const telegramMessage = `
    🛎️ *Nuovo Evento Registrato* 🛎️
    👤 *Nick:* ${escapeMarkdown(userID)}
    🆔 *Transaction ID:* ${escapeMarkdown(transactionID)}
    💰 *Revenue:* ${escapeMarkdown(revenue || "N/A")}
    🏆 *Numero Punti:* ${escapeMarkdown(currencyAmount)}
    🔒 *Hash:* ${escapeMarkdown(hash || "N/A")}
    🌐 *IP Utente:* ${escapeMarkdown(ip || "N/A")}
    📄 *Tipo Transazione:* ${escapeMarkdown(type || "N/A")}
  `;

  try {
    // Invio del messaggio a Telegram
    const telegramURL = `https://api.telegram.org/bot${TELEGRAM_API_TOKEN}/sendMessage`;
    const response = await fetch(telegramURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: telegramMessage,
        parse_mode: "MarkdownV2"
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Errore API Telegram:", error);
      res.status(response.status).json({ error: `Errore API Telegram: ${error}` });
      return;
    }

    res.json({ success: true, message: "Messaggio inviato a Telegram!" });
  } catch (error) {
    console.error("Errore durante l'invio a Telegram:", error);
    res.status(500).json({ error: "Errore interno durante l'invio del messaggio." });
  }
});

// Route di test
app.get("/postback", (req, res) => {
  res.send("La route POSTBACK è attiva. Usa una richiesta POST con i parametri corretti.");
});

// Route di benvenuto
app.get("/", (req, res) => {
  res.send("Benvenuto nel server! Usa l'endpoint POST /postback per inviare notifiche tramite Telegram.");
});

// Avvio del server
app.listen(PORT, () => {
  console.log(`Server in esecuzione su porta ${PORT}`);
});
