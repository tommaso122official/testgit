// ===== Imports =====
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // v2 per require
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios"); // presente come nell'originale

// ===== App Express =====
const app = express();
const PORT = process.env.PORT || 3000;

// ===== Config da ENV =====
const TELEGRAM_API_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const GUILD_ID       = process.env.DISCORD_GUILD_ID;  // usato per fetch member
const ROLE_ID        = process.env.DISCORD_ROLE_ID;

const TIMEWALL_OID   = process.env.TIMEWALL_OID || "e81e5fbe6a8a28a1";

// ===== Persistenza su file =====
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.txt");
// struttura persistita: { userBalances, rewards, userLangs }
let db = { userBalances: {}, rewards: {}, userLangs: {} };

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const txt = fs.readFileSync(DB_PATH, "utf8");
      const parsed = JSON.parse(txt || "{}");
      db.userBalances = parsed.userBalances || {};
      db.rewards      = parsed.rewards      || {};
      db.userLangs    = parsed.userLangs    || {};
      console.log(`📦 DB caricato: ${Object.keys(db.userBalances).length} utenti, ${Object.keys(db.rewards).length} rewards, ${Object.keys(db.userLangs).length} lingue.`);
    } else {
      console.log("📦 DB non trovato, creo un nuovo file.");
      saveDB();
    }
  } catch (e) { console.error("Errore lettura DB:", e); }
}
function saveDB() {
  try {
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmp, DB_PATH);
  } catch (e) { console.error("Errore salvataggio DB:", e); }
}
let saveTimer = null;
function queueSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveDB, 200); }
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
function hasRole(member, roleId) { try { return member.roles.cache.has(roleId); } catch { return false; } }

// ===== I18N (it/en) =====
const i18n = {
  it: {
    help:
`**Ecco l'elenco dei comandi disponibili:**

**Comandi per tutti:**
\`!help\` - Mostra questo messaggio di aiuto.
\`!balance\` - Mostra il tuo bilancio.
\`!rewards\` - Mostra la lista delle ricompense disponibili.
\`!rewardclaim <nome> <quantità>\` - Riscatta una ricompensa se hai abbastanza coins.
\`!register\` - Ricevi in privato il link univoco di registrazione su Timewall.
\`!lang <it|en>\` - Imposta/Modifica la lingua del bot.
$ADMIN$`,
    adminHelp:
`
**Comandi riservati (richiedono ruolo specifico):**
\`!addbalance @user <amount>\`
\`!removebalance @user <amount>\`
\`!createreward <name> <cost>\`
\`!addreward <name> <code>\`
\`!deletereward <name>\`
\`!balanceuser @user\`
`,
    addbalanceUsage: "Usa il comando: `!addbalance @username <ammount>`",
    removebalanceUsage: "Usa il comando: `!removebalance @username`",
    createrewardUsage: "Usa il comando: `!createreward <nome> <prezzo>`",
    addrewardMissing: (name)=>`La ricompensa "${name}" non esiste.`,
    addrewardUsage: "Usa il comando: `!addreward <nome> <codice>`",
    deleterewardMissing: (name)=>`La ricompensa "${name}" non esiste.`,
    balanceuserUsage: "Usa il comando: `!balanceuser @username`",
    balanceIs: (tag,b)=>`${tag} ha un bilancio di ${b} coins.`,
    youBalance: (b)=>`Hai un bilancio di ${b} coins.`,
    rewardsListHeader: "Ricompense disponibili:",
    rewardsListEmpty: "Nessuna ricompensa disponibile.",
    rewardMissing: (name)=>`La ricompensa "${name}" non esiste.`,
    rewardQtyUsage: "Usa il comando: `!rewardclaim <nome> <quantità>`",
    rewardNotEnough: (name)=>`Non ci sono abbastanza codici disponibili per "${name}".`,
    notEnoughCoins: (need,have)=>`Non hai abbastanza coins. Ti servono ${need}, ma hai solo ${have}.`,
    claimedDM: (q,name,codes)=>`Hai riscattato ${q} codici per "${name}": ${codes.join(", ")}`,
    claimedPublic: (q,name,b)=>`Hai riscattato ${q} codici per "${name}". Bilancio rimanente: ${b} coins.`,
    addedCoins: (amt,tag,b)=>`Aggiunto ${amt} coins a ${tag}. Bilancio attuale: ${b} coins.`,
    removedBalance: (tag)=>`Bilancio rimosso per ${tag}.`,
    rewardCreated: (name,price)=>`Ricompensa "${name}" creata con prezzo ${price} coins.`,
    codeAdded: (name,count)=>`Codice aggiunto alla ricompensa "${name}". Stock attuale: ${count}.`,
    rewardDeleted: (name)=>`Ricompensa "${name}" eliminata e codici inviati in privato.`,
    remainingCodesDM: (name,remaining)=>`Codici rimanenti per "${name}": ${remaining}`,
    registerDM: (url)=>`Ecco il tuo link di registrazione: ${url}`,
    langSet: (lang)=>`Lingua impostata su ${lang === "it" ? "italiano" : "inglese"}.`,
    langUsage: "Usa: `!lang it` oppure `!lang en`"
  },
  en: {
    help:
`**Here are the available commands:**

**For everyone:**
\`!help\` - Show this help message.
\`!balance\` - Show your balance.
\`!rewards\` - Show the list of available rewards.
\`!rewardclaim <name> <qty>\` - Redeem a reward if you have enough coins.
\`!register\` - Receive your unique Timewall registration link in DM.
\`!lang <it|en>\` - Set/Change the bot language.
$ADMIN$`,
    adminHelp:
`
**Admin-only (role required):**
\`!addbalance @user <amount>\`
\`!removebalance @user <amount>\`
\`!createreward <name> <cost>\`
\`!addreward <name> <code>\`
\`!deletereward <name>\`
\`!balanceuser @user\`
`,
    addbalanceUsage: "Use: `!addbalance @username <ammount>`",
    removebalanceUsage: "Use: `!removebalance @username`",
    createrewardUsage: "Use: `!createreward <name> <price>`",
    addrewardMissing: (name)=>`Reward "${name}" does not exist.`,
    addrewardUsage: "Use: `!addreward <name> <code>`",
    deleterewardMissing: (name)=>`Reward "${name}" does not exist.`,
    balanceuserUsage: "Use: `!balanceuser @username`",
    balanceIs: (tag,b)=>`${tag} has a balance of ${b} coins.`,
    youBalance: (b)=>`You have a balance of ${b} coins.`,
    rewardsListHeader: "Available rewards:",
    rewardsListEmpty: "No rewards available.",
    rewardMissing: (name)=>`Reward "${name}" does not exist.`,
    rewardQtyUsage: "Use: `!rewardclaim <name> <quantity>`",
    rewardNotEnough: (name)=>`Not enough codes available for "${name}".`,
    notEnoughCoins: (need,have)=>`Not enough coins. You need ${need}, but you only have ${have}.`,
    claimedDM: (q,name,codes)=>`You redeemed ${q} codes for "${name}": ${codes.join(", ")}`,
    claimedPublic: (q,name,b)=>`You redeemed ${q} codes for "${name}". Remaining balance: ${b} coins.`,
    addedCoins: (amt,tag,b)=>`Added ${amt} coins to ${tag}. Current balance: ${b} coins.`,
    removedBalance: (tag)=>`Balance removed for ${tag}.`,
    rewardCreated: (name,price)=>`Reward "${name}" created with price ${price} coins.`,
    codeAdded: (name,count)=>`Code added to "${name}". Current stock: ${count}.`,
    rewardDeleted: (name)=>`Reward "${name}" deleted and codes sent in DM.`,
    remainingCodesDM: (name,remaining)=>`Remaining codes for "${name}": ${remaining}`,
    registerDM: (url)=>`Here’s your registration link: ${url}`,
    langSet: (lang)=>`Language set to ${lang === "it" ? "Italian" : "English"}.`,
    langUsage: "Use: `!lang it` or `!lang en`"
  }
};
function getLang(userId){ return db.userLangs[userId] || "it"; }
function setLang(userId, lang){ db.userLangs[userId] = lang; queueSave(); }
function T(userId, key, ...args){
  const lang = getLang(userId);
  const pack = i18n[lang];
  const val = pack[key];
  return typeof val === "function" ? val(...args) : val;
}

// ===== /postback → Telegram (GET/POST) =====
app.all("/postback", async (req, res) => {
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

// ===== Discord Bot (identico per logica/comandi) =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
});

const userBalances = db.userBalances;
const rewards      = db.rewards;

client.once("ready", () => {
  console.log(`Bot connesso come ${client.user.tag}`);
});

// Anti-doppio listener
if (!global.botMessageHandlerRegistered) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!")) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const senderId = message.author.id;

    // fetch member come nel tuo originale
    let member = null;
    try {
      if (message.guild) {
        member = await message.guild.members.fetch(senderId);
      } else if (GUILD_ID) {
        const g = await client.guilds.fetch(GUILD_ID);
        member = await g.members.fetch(senderId);
      }
    } catch (_) {}

    // comando lingua per-utente
    if (command === "lang") {
      const lang = (args[0] || "").toLowerCase();
      if (lang !== "it" && lang !== "en") return message.reply(T(senderId, "langUsage"));
      setLang(senderId, lang);
      return message.reply(T(senderId, "langSet", lang));
    }

    // ===== Admin (ruolo richiesto) =====
    if (member && hasRole(member, ROLE_ID)) {
      if (command === "addbalance") {
        const target = message.mentions.users.first();
        const amount = parseInt(args[1]);
        if (!target || isNaN(amount)) return message.reply(T(senderId, "addbalanceUsage"));
        userBalances[target.id] = (userBalances[target.id] || 0) + amount;
        queueSave();
        return message.reply(T(senderId, "addedCoins", amount, target.tag, userBalances[target.id]));
      }

      if (command === "removebalance") {
        const target = message.mentions.users.first();
        if (!target) return message.reply(T(senderId, "removebalanceUsage"));
        delete userBalances[target.id];
        queueSave();
        return message.reply(T(senderId, "removedBalance", target.tag));
      }

      if (command === "createreward") {
        const rewardName = args[0];
        const price = parseInt(args[1]);
        if (!rewardName || isNaN(price)) return message.reply(T(senderId, "createrewardUsage"));
        rewards[rewardName] = { price, codes: [] };
        queueSave();
        return message.reply(T(senderId, "rewardCreated", rewardName, price));
      }

      if (command === "addreward") {
        const rewardName = args[0];
        const code = args[1];
        if (!rewards[rewardName]) return message.reply(T(senderId, "addrewardMissing", rewardName));
        if (!code) return message.reply(T(senderId, "addrewardUsage"));
        rewards[rewardName].codes.push(code);
        queueSave();
        return message.reply(T(senderId, "codeAdded", rewardName, rewards[rewardName].codes.length));
      }

      if (command === "deletereward") {
        const rewardName = args[0];
        if (!rewards[rewardName]) return message.reply(T(senderId, "deleterewardMissing", rewardName));
        const remainingCodes = rewards[rewardName].codes.join(", ");
        delete rewards[rewardName];
        queueSave();
        try { await message.author.send(T(senderId, "remainingCodesDM", rewardName, remainingCodes)); } catch {}
        return message.reply(T(senderId, "rewardDeleted", rewardName));
      }

      if (command === "balanceuser") {
        const target = message.mentions.users.first();
        if (!target) return message.reply(T(senderId, "balanceuserUsage"));
        const balance = userBalances[target.id] || 0;
        return message.reply(T(senderId, "balanceIs", target.tag, balance));
      }
    }

    // ===== Comandi per tutti =====
    if (command === "balance") {
      const balance = userBalances[senderId] || 0;
      return message.reply(T(senderId, "youBalance", balance));
    }

    if (command === "rewards") {
      const entries = Object.entries(rewards);
      if (entries.length === 0) return message.reply(T(senderId, "rewardsListEmpty"));
      const rewardList = entries
        .map(([name, data]) =>
          `${name}: ${data.codes.length} ${getLang(senderId)==="it"?"disponibili a":"available at"} ${data.price} coins`
        )
        .join("\n");
      return message.reply(`${T(senderId, "rewardsListHeader")}\n${rewardList}`);
    }

    if (command === "rewardclaim") {
      const rewardName = args[0];
      const quantity = parseInt(args[1]);
      if (!rewards[rewardName]) return message.reply(T(senderId, "rewardMissing", rewardName));
      if (isNaN(quantity) || quantity <= 0) return message.reply(T(senderId, "rewardQtyUsage"));
      if (quantity > rewards[rewardName].codes.length) return message.reply(T(senderId, "rewardNotEnough", rewardName));

      const cost = rewards[rewardName].price * quantity;
      const balance = userBalances[senderId] || 0;
      if (balance < cost) return message.reply(T(senderId, "notEnoughCoins", cost, balance));

      userBalances[senderId] = balance - cost;
      const claimedCodes = rewards[rewardName].codes.splice(0, quantity);
      queueSave();

      try { await message.author.send(T(senderId, "claimedDM", quantity, rewardName, claimedCodes)); } catch {}
      return message.reply(T(senderId, "claimedPublic", quantity, rewardName, userBalances[senderId]));
    }

    if (command === "register") {
      const registrationLink = `https://timewall.io/users/login?oid=${TIMEWALL_OID}&uid=${senderId}`;
      return message.author.send(T(senderId, "registerDM", registrationLink));
    }

    if (command === "help") {
      const isAdmin = !!(member && hasRole(member, ROLE_ID));
      const text = T(senderId, "help").replace("$ADMIN$", isAdmin ? T(senderId, "adminHelp") : "");
      return message.reply(text);
    }
  });

  global.botMessageHandlerRegistered = true;
}

// Login del bot
if (!DISCORD_TOKEN) {
  console.warn("⚠️  DISCORD_TOKEN non impostato: il bot Discord non verrà avviato.");
} else {
  client.login(DISCORD_TOKEN).catch((e) => console.error("Errore login Discord:", e?.message || e));
}
