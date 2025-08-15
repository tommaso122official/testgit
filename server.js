// ===== Imports =====
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // v2 per require
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// ===== App Express =====
const app = express();
const PORT = process.env.PORT || 3000;

// ===== Config da ENV =====
const TELEGRAM_API_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const DISCORD_TOKEN      = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID   = process.env.DISCORD_GUILD_ID;
const DISCORD_ROLE_ID    = process.env.DISCORD_ROLE_ID;
const TIMEWALL_OID       = process.env.TIMEWALL_OID || "e81e5fbe6a8a28a1";

// ===== Persistenza su file =====
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.txt");
let db = { userBalances: {}, rewards: {} };

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const txt = fs.readFileSync(DB_PATH, "utf8");
      const parsed = JSON.parse(txt || "{}");
      db.userBalances = parsed.userBalances || {};
      db.rewards = parsed.rewards || {};
      console.log(`📦 DB caricato: ${Object.keys(db.userBalances).length} utenti, ${Object.keys(db.rewards).length} rewards.`);
    } else {
      console.log("📦 DB non trovato, creo un nuovo file.");
      saveDB();
    }
  } catch (e) {
    console.error("Errore lettura DB:", e);
  }
}
function saveDB() {
  try {
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmp, DB_PATH);
  } catch (e) {
    console.error("Errore salvataggio DB:", e);
  }
}
let saveTimer = null;
function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDB, 200);
}
loadDB();

// ===== Middleware =====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== Utils =====
function escapeMarkdown(text) {
  return String(text)
    .replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
    .replace(/~/g, "\\~").replace(/\\/g, "\\\\").replace(/>/g, "\\>")
    .replace(/#/g, "\\#").replace(/\+/g, "\\+").replace(/-/g, "\\-")
    .replace(/=/g, "\\=").replace(/\|/g, "\\|").replace(/{/g, "\\{")
    .replace(/}/g, "\\}").replace(/\./g, "\\.").replace(/!/g, "\\!");
}
function hasRole(member, roleId) {
  try { return !!member?.roles?.cache?.has(roleId); } catch { return false; }
}

// ===== /postback → Telegram (GET/POST) =====
app.all("/postback", async (req, res) => {
  console.log("Metodo:", req.method, "Query:", req.query, "Body:", req.body);
  const src = { ...req.query, ...req.body };
  const { userID, transactionID, revenue, currencyAmount, hash, ip, type } = src;

  if (!userID || !transactionID || !currencyAmount) {
    return res.status(400).json({ error: "Parametri obbligatori mancanti: userID, transactionID o currencyAmount." });
  }
  if (!TELEGRAM_API_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ error: "Config Telegram mancante: TELEGRAM_API_TOKEN/TELEGRAM_CHAT_ID." });
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
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_API_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: telegramMessage, parse_mode: "MarkdownV2" })
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error("Errore API Telegram:", err);
      return res.status(resp.status).json({ error: `Errore API Telegram: ${err}` });
    }
    return res.json({ success: true, message: "Messaggio inviato a Telegram!" });
  } catch (e) {
    console.error("Errore Telegram:", e);
    return res.status(500).json({ error: "Errore interno durante l'invio del messaggio." });
  }
});

// ===== Rotte base =====
app.get("/", (_req, res) => res.send("Server attivo. Endpoint: GET/POST /postback"));
app.get("/health", (_req, res) => res.json({ ok: true }));

// ===== Avvio server =====
app.listen(PORT, () => {
  console.log(`Server in esecuzione su porta ${PORT} (PID: ${process.pid})`);
});

// ===== Discord Bot =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel],
});

client.on("error", (e) => console.error("[Discord ERROR]", e));
client.on("warn", (w) => console.warn("[Discord WARN]", w));

client.once("ready", () => {
  console.log(`🤖 Discord bot connesso come ${client.user.tag} (PID: ${process.pid})`);
});

// ---- Evita doppi listener ----
if (!global.botMessageHandlerRegistered) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!")) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const senderId = message.author.id;

    let member = null;
    if (message.guild) member = message.member;

    // HELP
    if (command === "help") {
      return message.reply(
        "**Comandi disponibili:**\n" +
        "`!help` — mostra questo messaggio\n" +
        "`!balance` — mostra il tuo saldo\n" +
        "`!rewards` — lista ricompense\n" +
        "`!rewardclaim <nome> <qty>` — riscatta codici\n" +
        "`!register` — link registrazione\n" +
        (hasRole(member, DISCORD_ROLE_ID)
          ? "\n**Admin:** `!addbalance @user <amm>`, `!removebalance @user`, `!createreward <nome> <prezzo>`, `!addreward <nome> <codice>`, `!deletereward <nome>`, `!balanceuser @user`"
          : "")
      );
    }

    // Admin
    if (member && hasRole(member, DISCORD_ROLE_ID)) {
      if (command === "addbalance") {
        const target = message.mentions.users.first();
        const amount = parseInt(args[1], 10);
        if (!target || isNaN(amount)) return message.reply("Usa: `!addbalance @username <amount>`");
        db.userBalances[target.id] = (db.userBalances[target.id] || 0) + amount;
        queueSave();
        return message.reply(`Aggiunto ${amount} coins a ${target.tag}. Bilancio: ${db.userBalances[target.id]} coins.`);
      }

      if (command === "removebalance") {
        const target = message.mentions.users.first();
        if (!target) return message.reply("Usa: `!removebalance @username`");
        delete db.userBalances[target.id];
        queueSave();
        return message.reply(`Bilancio rimosso per ${target.tag}.`);
      }

      if (command === "createreward") {
        const rewardName = args[0];
        const price = parseInt(args[1], 10);
        if (!rewardName || isNaN(price)) return message.reply("Usa: `!createreward <nome> <prezzo>`");
        db.rewards[rewardName] = { price, codes: [] };
        queueSave();
        return message.reply(`Ricompensa "${rewardName}" creata a ${price} coins.`);
      }

      if (command === "addreward") {
        const rewardName = args[0];
        const code = args[1];
        if (!db.rewards[rewardName]) return message.reply(`La ricompensa "${rewardName}" non esiste.`);
        if (!code) return message.reply("Usa: `!addreward <nome> <codice>`");
        db.rewards[rewardName].codes.push(code);
        queueSave();
        return message.reply(`Codice aggiunto. Stock "${rewardName}": ${db.rewards[rewardName].codes.length}.`);
      }

      if (command === "deletereward") {
        const rewardName = args[0];
        if (!db.rewards[rewardName]) return message.reply(`La ricompensa "${rewardName}" non esiste.`);
        const remainingCodes = db.rewards[rewardName].codes.join(", ");
        delete db.rewards[rewardName];
        queueSave();
        try { await message.author.send(`Codici rimanenti per "${rewardName}": ${remainingCodes || "(nessuno)"}`); } catch {}
        return message.reply(`Ricompensa "${rewardName}" eliminata e codici inviati in privato.`);
      }

      if (command === "balanceuser") {
        const target = message.mentions.users.first();
        if (!target) return message.reply("Usa: `!balanceuser @username`");
        const balance = db.userBalances[target.id] || 0;
        return message.reply(`${target.tag} ha un bilancio di ${balance} coins.`);
      }
    }

    // Pubblici
    if (command === "balance") {
      const balance = db.userBalances[senderId] || 0;
      return message.reply(`Hai un bilancio di ${balance} coins.`);
    }

    if (command === "rewards") {
      const rewardList = Object.entries(db.rewards)
        .map(([name, data]) => `${name}: ${data.codes.length} disponibili a ${data.price} coins`)
        .join("\n");
      return message.reply(rewardList ? `Ricompense disponibili:\n${rewardList}` : "Nessuna ricompensa disponibile.");
    }

    if (command === "rewardclaim") {
      const rewardName = args[0];
      const quantity = parseInt(args[1], 10);
      if (!db.rewards[rewardName]) return message.reply(`La ricompensa "${rewardName}" non esiste.`);
      if (isNaN(quantity) || quantity <= 0) return message.reply("Usa: `!rewardclaim <nome> <quantità>`");
      if (quantity > db.rewards[rewardName].codes.length) return message.reply(`Stock insufficiente per "${rewardName}".`);
      const cost = db.rewards[rewardName].price * quantity;
      const balance = db.userBalances[senderId] || 0;
      if (balance < cost) return message.reply(`Servono ${cost} coins, ne hai ${balance}.`);

      db.userBalances[senderId] = balance - cost;
      const claimedCodes = db.rewards[rewardName].codes.splice(0, quantity);
      queueSave();

      try { await message.author.send(`Hai riscattato ${quantity} codici per "${rewardName}": ${claimedCodes.join(", ")}`); } catch {}
      return message.reply(`Riscatto ok. Bilancio rimanente: ${db.userBalances[senderId]} coins.`);
    }

    if (command === "register") {
      const link = `https://timewall.io/users/login?oid=${TIMEWALL_OID}&uid=${senderId}`;
      try { await message.author.send(`Ecco il tuo link di registrazione: ${link}`); }
      catch { return message.reply("Non riesco a scriverti in privato. Abilita i DM o scrivimi un messaggio."); }
      return message.reply("Ti ho mandato il link in privato.");
    }
  });

  global.botMessageHandlerRegistered = true;
}

// Avvia bot (metti DISCORD_ENABLE=true per controllare l’avvio opzionalmente)
if (!DISCORD_TOKEN) {
  console.warn("⚠️  DISCORD_TOKEN non impostato: il bot Discord non verrà avviato.");
} else if (process.env.DISCORD_ENABLE && process.env.DISCORD_ENABLE !== "true") {
  console.warn("ℹ️  DISCORD_ENABLE != true: avvio Discord disabilitato per questa istanza.");
} else {
  client.login(DISCORD_TOKEN).catch((e) => console.error("Errore login Discord:", e?.message || e));
}
