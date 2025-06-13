require("dotenv").config();
const connectDB = require("./src/database/connect.js");
const { Client, Collection, Intents } = require("discord.js");
const fs = require("fs");
const fetch = require("node-fetch");
const config = require("./config.js");

global.config = config;

// Inizializza il client Discord con gli intent necessari
const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]
});

// Funzione per caricare tutti i comandi da src/commands
function loadCommands() {
  client.commands = new Collection();
  client.aliases  = new Collection();

  const commandFiles = fs
    .readdirSync("./src/commands")
    .filter(file => file.endsWith(".js"));

  console.log(`(!) Caricati ${commandFiles.length} comandi.`);
  for (const file of commandFiles) {
    const cmd = require(`./src/commands/${file}`);
    if (!cmd.help) continue;
    client.commands.set(cmd.help.name, cmd);
    for (const alias of cmd.conf.aliases) {
      client.aliases.set(alias, cmd.help.name);
    }
  }
}

// Handler per i messaggi
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  const prefix = config.bot.prefix;
  if (!message.content.startsWith(prefix)) return;

  const [cmdName, ...params] = message.content
    .slice(prefix.length)
    .trim()
    .split(/\s+/);

  const key = client.commands.has(cmdName)
    ? cmdName
    : client.aliases.get(cmdName);

  if (!key) return;

  try {
    await client.commands.get(key).run(client, message, params, prefix);
  } catch (err) {
    console.error("Errore esecuzione comando:", err);
    message.reply("❌ Si è verificato un errore durante l'esecuzione del comando.");
  }
});

// Funzione principale di bootstrap
(async () => {
  // 1) Connetti a MongoDB Atlas
  await connectDB();

  // 2) Carica comandi
  loadCommands();

  // 3) Inizializza eventuale web server
  require("./src/server.js")(client);

  // 4) Registra l'evento 'ready'
  client.once("ready", async () => {
    console.log(`🤖 Bot avviato come ${client.user.tag}`);

    // Presenza dinamica basata sul numero di bot registrati
    const botsSchema = require("./src/database/models/botlist/bots.js");
    try {
      const bots = await botsSchema.find();
      client.user.setPresence({
        activities: [{ type: "WATCHING", name: `${bots.length} Bots` }],
        status: "dnd"
      });
    } catch (err) {
      console.error("Errore fetching bots per presence:", err);
    }

    // Uptime ping
    const claudette = require("./src/database/models/uptime.js");
    setInterval(() => {
      claudette.find({}, (err, docs) => {
        if (err) return console.error(err);
        if (docs && docs.length) {
          docs.forEach(doc => fetch(doc.link).catch());
        }
      });
    }, 300000);

    // Cleanup dei vote scaduti
    const votes = require("./src/database/models/botlist/vote.js");
    setInterval(async () => {
      const all = await votes.find();
      all.forEach(async a => {
        if (a.ms - (Date.now() - a.Date) <= 0) {
          await votes.findOneAndDelete({ bot: a.bot, user: a.user });
        }
      });
    }, 1500000);

    // Gestione join/leave
    client.on("guildMemberRemove", async member => {
      if (member.guild.id !== config.server.id) return;
      // Rimuove uptime per utente uscito
      claudette.find({ userID: member.id }, (err, docs) => {
        if (err) return console.error(err);
        if (docs && docs.length) {
          docs.forEach(d => {
            claudette.findOneAndDelete({ userID: d.userID, code: d.code, link: d.link }).catch(console.error);
          });
        }
      });

      // Kicks e pulizia botlist
      const botSchema = require("./src/database/models/botlist/bots.js");
      const bots = await botSchema.find({ ownerID: member.id });
      bots.forEach(async b => {
        const guild = client.guilds.cache.get(config.server.id);
        guild.members.cache.get(b.botID)?.kick().catch();
        await botSchema.deleteOne({ botID: b.botID });
      });
    });

    client.on("guildMemberAdd", async member => {
      if (!member.user.bot) return;
      const guild = client.guilds.cache.get(config.server.id);
      guild.members.cache.get(member.id)?.roles.add(config.server.roles.bot).catch();
    });
  });

  // 5) Effettua login su Discord
  await client.login(config.bot.token);
  console.log("🔐 Login Discord effettuato");
})().catch(err => {
  console.error("Bootstrap hatası:", err);
  process.exit(1);
});

// Gestione globale delle promise non gestite
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
