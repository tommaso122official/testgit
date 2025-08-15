// ===== Imports =====
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // usa v2 con require
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// ===== App Express =====
const app = express();
const PORT = process.env.PORT || 3000;

// ===== Config da ENV =====
// Telegram
const TELEGRAM_API_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// Discord
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_ROLE_ID  = process.env.DISCORD_ROLE_ID;

// Altre (opzionale)
const TIMEWALL_OID = process.env.TIMEWALL_OID || "e81e5fbe6a8a28a1";

// ===== Middleware =====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== Utils =====
function escapeMarkdown(text) {
  return String(text)
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

// ===== Route POST/GET /postback → invio messaggio a Telegram =====
app.all("/postback", async (req, res) => {
  const method = req.method;
  console.log("Metodo ricevuto:", method);
  console.log("Query:", req.query);
  console.log("Body:", req.body);

  // ✅ Accetta sia querystring che body (JSON o form)
  const src = { ...req.query, ...req.body };
  const { userID, transactionID, revenue, currencyAmount, hash, ip, type } = src;

  if (!userID || !transactionID || !currencyAmount) {
    return res.status(400).json({
      error: "Parametri obbligatori mancanti: userID, transactionID o currencyAmount."
    });
  }
  if (!TELEGRAM_API_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({
      error: "Config Telegram mancante: imposta TELEGRAM_API_TOKEN e TELEGRAM_CHAT_ID."
    });
  }

  const telegramMessage =
    `🛎️ *Nuovo Evento Registrato* 🛎️\n` +
    `👤 *Nick:* ${escapeMarkdown(userID)}\n` +
    `🆔 *Transaction ID:* ${escapeMarkdown(transactionID)}\n` +
    `💰 *Revenue:* ${escapeMarkdown(revenue || "N/A")}\n` +
    `🏆 *Numero Punti:* ${escapeMarkdown(currencyAmount)}\n` +
    `🔒 *Hash:* ${escapeMarkdown(hash || "N/A")}\n` +
    `🌐 *IP Utente:* ${escapeMarkdown(ip || "N/A")}\n` +
    `📄 *Tipo Transazione:* ${escapeMarkdown(type || "N/A")}`;

  try {
    const telegramURL = `https://api.telegram.org/bot${TELEGRAM_API_TOKEN}/sendMessage`;
    const response = await fetch(telegramURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: telegramMessage,
        parse_mode: "MarkdownV2"
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Errore API Telegram:", error);
      return res.status(response.status).json({ error: `Errore API Telegram: ${error}` });
    }

    return res.json({ success: true, message: "Messaggio inviato a Telegram!" });
  } catch (err) {
    console.error("Errore durante l'invio a Telegram:", err);
    return res.status(500).json({ error: "Errore interno durante l'invio del messaggio." });
  }
});

// ===== Rotte base =====
app.get("/", (req, res) => {
  res.send("Server attivo. Endpoint: GET/POST /postback");
});
app.get("/health", (req, res) => res.json({ ok: true }));

// ===== Avvio server =====
app.listen(PORT, () => {
  const localURL = `http://localhost:${PORT}`;
  const host = process.env.HOST || "localhost";
  const possibleURL = `http://${host}:${PORT}`;
  console.log(`Server in esecuzione su porta ${PORT}`);
  console.log(`🔗 URL locale: ${localURL}`);
  console.log(`🔗 URL possibile esterno: ${possibleURL}`);
});

// ===== Discord Bot =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel], // per DM
});

// DB in memoria (si resetta a ogni riavvio)
const userBalances = {}; // { userId: balance }
const rewards = {};      // { rewardName: { price, codes: [] } }

function hasRole(member, roleId) {
  try {
    return !!member?.roles?.cache?.has(roleId);
  } catch {
    return false;
  }
}

client.once("ready", () => {
  console.log(`🤖 Discord bot connesso come ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  // ignora bot e messaggi senza prefisso "!"
  if (message.author.bot || !message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  const senderId = message.author.id;

  // ✅ Usa il member già presente (niente fetch → niente intent GuildMembers)
  let member = null;
  if (message.guild) {
    member = message.member;
  }

  // ====== Comandi Admin (richiedono ruolo) ======
  if (member && hasRole(member, DISCORD_ROLE_ID)) {
    if (command === "addbalance") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[1], 10);
      if (!target || isNaN(amount)) {
        return message.reply("Usa: `!addbalance @username <amount>`");
      }
      userBalances[target.id] = (userBalances[target.id] || 0) + amount;
      return message.reply(`Aggiunto ${amount} coins a ${target.tag}. Bilancio: ${userBalances[target.id]} coins.`);
    }

    if (command === "removebalance") {
      const target = message.mentions.users.first();
      if (!target) return message.reply("Usa: `!removebalance @username`");
      delete userBalances[target.id];
      return message.reply(`Bilancio rimosso per ${target.tag}.`);
    }

    if (command === "createreward") {
      const rewardName = args[0];
      const price = parseInt(args[1], 10);
      if (!rewardName || isNaN(price)) {
        return message.reply("Usa: `!createreward <nome> <prezzo>`");
      }
      rewards[rewardName] = { price, codes: [] };
      return message.reply(`Ricompensa "${rewardName}" creata a ${price} coins.`);
    }

    if (command === "addreward") {
      const rewardName = args[0];
      const code = args[1];
      if (!rewards[rewardName]) {
        return message.reply(`La ricompensa "${rewardName}" non esiste.`);
      }
      if (!code) return message.reply("Usa: `!addreward <nome> <codice>`");
      rewards[rewardName].codes.push(code);
      return message.reply(`Codice aggiunto. Stock "${rewardName}": ${rewards[rewardName].codes.length}.`);
    }

    if (command === "deletereward") {
      const rewardName = args[0];
      if (!rewards[rewardName]) {
        return message.reply(`La ricompensa "${rewardName}" non esiste.`);
      }
      const remainingCodes = rewards[rewardName].codes.join(", ");
      delete rewards[rewardName];
      try {
        await message.author.send(`Codici rimanenti per "${rewardName}": ${remainingCodes || "(nessuno)"}`);
      } catch {}
      return message.reply(`Ricompensa "${rewardName}" eliminata e codici inviati in privato.`);
    }

    if (command === "balanceuser") {
      const target = message.mentions.users.first();
      if (!target) return message.reply("Usa: `!balanceuser @username`");
      const balance = userBalances[target.id] || 0;
      return message.reply(`${target.tag} ha un bilancio di ${balance} coins.`);
    }
  }

  // ====== Comandi aperti a tutti ======
  if (command === "balance") {
    const balance = userBalances[senderId] || 0;
    return message.reply(`Hai un bilancio di ${balance} coins.`);
  }

  if (command === "rewards") {
    const rewardList = Object.entries(rewards)
      .map(([name, data]) => `${name}: ${data.codes.length} disponibili a ${data.price} coins`)
      .join("\n");
    return message.reply(rewardList ? `Ricompense disponibili:\n${rewardList}` : "Nessuna ricompensa disponibile.");
  }

  if (command === "rewardclaim") {
    const rewardName = args[0];
    const quantity = parseInt(args[1], 10);
    if (!rewards[rewardName]) {
      return message.reply(`La ricompensa "${rewardName}" non esiste.`);
    }
    if (isNaN(quantity) || quantity <= 0) {
      return message.reply("Usa: `!rewardclaim <nome> <quantità>`");
    }
    if (quantity > rewards[rewardName].codes.length) {
      return message.reply(`Stock insufficiente per "${rewardName}".`);
    }
    const cost = rewards[rewardName].price * quantity;
    const balance = userBalances[senderId] || 0;
    if (balance < cost) {
      return message.reply(`Servono ${cost} coins, ne hai ${balance}.`);
    }
    userBalances[senderId] -= cost;
    const claimedCodes = rewards[rewardName].codes.splice(0, quantity);
    try {
      await message.author.send(`Hai riscattato ${quantity} codici per "${rewardName}": ${claimedCodes.join(", ")}`);
    } catch {}
    return message.reply(`Riscatto ok. Bilancio rimanente: ${userBalances[senderId]} coins.`);
  }

  if (command === "register") {
    const registrationLink = `https://timewall.io/users/login?oid=${TIMEWALL_OID}&uid=${senderId}`;
    try {
      await message.author.send(`Ecco il tuo link di registrazione: ${registrationLink}`);
    } catch {
      return message.reply("Non riesco a scriverti in privato. Abilita i DM o scrivimi un messaggio.");
    }
    return message.reply("Ti ho mandato il link in privato.");
  }
});

// Avvia il bot solo se è configurato
if (!DISCORD_TOKEN) {
  console.warn("⚠️  DISCORD_TOKEN non impostato: il bot Discord non verrà avviato.");
} else {
  client.login(DISCORD_TOKEN).catch((e) => {
    console.error("Errore login Discord:", e?.message || e);
  });
}
