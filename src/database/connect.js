const mongoose = require("mongoose");
const config = require("../../config.js");

module.exports = async function connectDB() {
  mongoose.connection.on("connecting", () =>
    console.log("🔌 Mongoose: tentativo di connessione…")
  );
  mongoose.connection.on("connected", () =>
    console.log("✅ Mongoose: connesso con successo")
  );
  mongoose.connection.on("error", err =>
    console.error("❌ Mongoose: errore di connessione", err)
  );

  try {
    await mongoose.connect(config.bot.mongourl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
  } catch (err) {
    console.error("🚨 Errore di connessione a MongoDB:", err);
    process.exit(1);
  }
};
