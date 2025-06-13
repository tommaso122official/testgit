module.exports = {
  bot: {
    token: process.env.BOT_TOKEN,
    prefix: process.env.PREFIX || "-",
    owners: (process.env.OWNERS || "").split(",").filter(x => x),
    mongourl: process.env.MONGO_URL
  },
  website: {
    callback: process.env.CALLBACK_URL,
    secret: process.env.SECRET,
    clientID: process.env.CLIENT_ID,
    tags: ["Moderation","Fun","Minecraft","Economy","Guard","NSFW","Anime","Invite","Music","Logging","Web Dashboard","Reddit","Youtube","Twitch","Crypto","Leveling","Game","Roleplay","Utility"]
  },
  server: {
    id: process.env.SERVER_ID,
    roles: {
      yonetici: process.env.ROLE_ADMIN,
      moderator: process.env.ROLE_MOD,
      profile: {
        booster: process.env.ROLE_BOOSTER,
        sponsor: process.env.ROLE_SPONSOR,
        supporter: process.env.ROLE_SUPPORTER,
        partnerRole: process.env.ROLE_PARTNER
      },
      codeshare: {
        javascript: process.env.ROLE_JS,
        html: process.env.ROLE_HTML,
        altyapilar: process.env.ROLE_SUBSTRUCTURE,
        bdfd: process.env.ROLE_BDFD,
        besdavet: process.env.ROLE_5INVITES,
        ondavet: process.env.ROLE_10INVITES,
        onbesdavet: process.env.ROLE_15INVITES,
        yirmidavet: process.env.ROLE_20INVITES
      },
      botlist: {
        developer: process.env.ROLE_DEV,
        certified_developer: process.env.ROLE_CERT_DEV,
        bot: process.env.ROLE_BOT,
        certified_bot: process.env.ROLE_CERT_BOT
      }
    },
    channels: {
      codelog: process.env.CHANNEL_CODELOG,
      login: process.env.CHANNEL_LOGIN,
      webstatus: process.env.CHANNEL_WEBSTATUS,
      uptimelog: process.env.CHANNEL_UPTIMELOG,
      botlog: process.env.CHANNEL_BOTLOG,
      votes: process.env.CHANNEL_VOTES
    }
  }
};
