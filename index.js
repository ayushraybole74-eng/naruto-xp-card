
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");

const { LavalinkManager } = require("lavalink-client");

// ================= CONFIG =================

const MAX_VOLUME = 247;
const searchSessions = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ================= ERROR HANDLING =================

client.on("error", error => {
  console.error("CLIENT ERROR:", error);
});

process.on("unhandledRejection", error => {
  console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", error => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

// ================= ENV CHECK =================

const requiredEnv = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "LAVALINK_HOST",
  "LAVALINK_PASSWORD"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

// ================= LAVALINK HOST =================

let lavalinkUrl;

try {
  const rawHost = process.env.LAVALINK_HOST.trim();

  lavalinkUrl = new URL(
    rawHost.includes("://") ? rawHost : `https://${rawHost}`
  );
} catch (error) {
  console.error("Invalid LAVALINK_HOST:", error.message);
  process.exit(1);
}

const lavalinkHost = lavalinkUrl.hostname;

const lavalinkPort = Number(
  process.env.LAVALINK_PORT ||
  lavalinkUrl.port ||
  (lavalinkUrl.protocol === "https:" ? 443 : 2333)
);

const lavalinkSecure =
  process.env.LAVALINK_SECURE === "false"
    ? false
    : lavalinkUrl.protocol === "https:";

// ================= SLASH COMMANDS =================

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search and play a song")
    .addStringOption(option =>
      option.setName("song")
        .setDescription("Song name or supported link")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause music"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume music"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip current song"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and clear queue"),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Leave voice channel"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show music queue"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set music volume")
    .addIntegerOption(option =>
      option.setName("level")
        .setDescription("Volume from 1 to 247")
        .setMinValue(1)
        .setMaxValue(MAX_VOLUME)
        .setRequired(true)
    )
].map(command => command.toJSON());

// ================= HELPERS =================

function makeEmbed(title, description, color = 0x5865F2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "DARK DJ • Music System" });
}

function durationText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "LIVE";

  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function trackDetails(track) {
  const info = track?.info || {};

  return {
    title: info.title || "Unknown title",
    author: info.author || "Unknown artist",
    duration: durationText(info.length),
    uri: info.uri || null,
    artwork: info.artworkUrl || info.thumbnail || null
  };
}

async function setPlayerVolume(player, volume) {
  const safeVolume = Math.max(
    1,
    Math.min(MAX_VOLUME, Math.round(volume))
  );

  await player.setVolume(safeVolume);
  return safeVolume;
}

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel || null;
}

// ================= PLAYER BUTTONS =================

function playerControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("darkdj_pause")
        .setLabel("Pause")
        .setEmoji("⏸️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_resume")
        .setLabel("Resume")
        .setEmoji("▶️")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("darkdj_skip")
        .setLabel("Skip")
        .setEmoji("⏭️")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("darkdj_shuffle")
        .setLabel("Shuffle")
        .setEmoji("🔀")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_stop")
        .setLabel("Stop")
        .setEmoji("⏹️")
        .setStyle(ButtonStyle.Danger)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("darkdj_vol_down")
        .setLabel("Volume -")
        .setEmoji("🔉")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_vol_up")
        .setLabel("Volume +")
        .setEmoji("🔊")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_disconnect")
        .setLabel("Disconnect")
        .setEmoji("🚪")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

// ================= PLAYER =================

async function getOrCreatePlayer(interaction, voice) {
  let player = client.lavalink.getPlayer(interaction.guildId);

  if (player && player.voiceChannelId !== voice.id) {
    throw new Error(
      "DARK DJ is already connected to another voice channel."
    );
  }

  if (!player) {
    player = client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voice.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 100
    });
  }

  if (!player.connected) {
    await player.connect();
  }

  return player;
}

// ================= LAVALINK MANAGER =================

client.lavalink = new LavalinkManager({
  nodes: [
    {
      id: "DARK-DJ",
      host: lavalinkHost,
      port: lavalinkPort,
      authorization: process.env.LAVALINK_PASSWORD,
      secure: lavalinkSecure,
      requestTimeout: 15000
    }
  ],

  sendToShard: (guildId, payload) => {
    client.guilds.cache.get(guildId)?.shard?.send(payload);
  },

  autoSkip: true,

  client: {
    id: process.env.CLIENT_ID,
    username: "DARK DJ"
  },

  playerOptions: {
    defaultSearchPlatform: "scsearch",

    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false
    }
  }
});

// Discord voice updates for Lavalink
client.on("raw", data => {
  client.lavalink.sendRawData(data);
});

// ================= LAVALINK EVENTS =================

client.lavalink.nodeManager.on("connect", node => {
  console.log("Lavalink connected:", node.id);
});

client.lavalink.nodeManager.on("error", (node, error) => {
  console.error("LAVALINK NODE ERROR:", error);
});

client.lavalink.on("trackStart", (player, track) => {
  console.log(
    "Now playing:",
    track?.info?.title || "Unknown track"
  );
});

client.lavalink.on("trackError", (player, track, payload) => {
  console.error(
    "TRACK ERROR:",
    track?.info?.title,
    payload
  );
});

client.lavalink.on("queueEnd", () => {
  console.log("Queue ended. Player remains available.");
});

// ================= BOT READY =================

client.once("ready", async () => {
  console.log(`DARK DJ Online: ${client.user.tag}`);

  try {
    await client.lavalink.init({
      id: client.user.id,
      username: client.user.username
    });

    const rest = new REST({ version: "10" })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("DARK DJ commands registered!");
  } catch (error) {
    console.error("STARTUP ERROR:", error);
  }
});

// ================= INTERACTION HANDLER =================

client.on("interactionCreate", async interaction => {

  // ---------- SONG SELECT MENU ----------

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("darkdj_search_")
  ) {
    try {
      await interaction.deferUpdate();

      const sessionId = interaction.customId.slice(
        "darkdj_search_".length
      );

      const session = searchSessions.get(sessionId);

      if (!session) {
        return interaction.followUp({
          content: "Search expired. Run /play again.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== session.requesterId) {
        return interaction.followUp({
          content: "Only the person who started this search can select a song.",
          ephemeral: true
        });
      }

      const selectedTrack =
        session.tracks[Number(interaction.values[0])];

      if (!selectedTrack) {
        return interaction.editReply({
          embeds: [
            makeEmbed("❌ Song unavailable", "Run `/play` again.")
          ],
          components: []
        });
      }

      const player = client.lavalink.getPlayer(
        interaction.guildId
      );

      if (!player) {
        return interaction.editReply({
          embeds: [
            makeEmbed("❌ Player unavailable", "Run `/play` again.")
          ],
          components: []
        });
      }

      await player.queue.add(selectedTrack);

      if (!player.playing) {
        await player.play();
      }

      searchSessions.delete(sessionId);

      const details = trackDetails(selectedTrack);

      const embed = makeEmbed(
        "💙 Added to DARK DJ",
        `**${details.title}**\n` +
        `👤 ${details.author}\n` +
        `⏱️ ${details.duration}\n\n` +
        `Requested by ${interaction.user}`
      );

      if (details.uri) embed.setURL(details.uri);
      if (details.artwork) embed.setThumbnail(details.artwork);

      return interaction.editReply({
        embeds: [embed],
        components: playerControls()
      });

    } catch (error) {
      console.error("SELECT MENU ERROR:", error);

      try {
        await interaction.followUp({
          content: "Could not add that song. Check the bot and Lavalink logs.",
          ephemeral: true
        });
      } catch (_) {}
    }

    return;
  }

  // ---------- PLAYER BUTTONS ----------

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("darkdj_")
  ) {
    try {
      await interaction.deferUpdate();

      const player = client.lavalink.getPlayer(
        interaction.guildId
      );

      if (!player || !player.connected) {
        return interaction.followUp({
          content: "DARK DJ is not connected to voice.",
          ephemeral: true
        });
      }

      const id = interaction.customId;

      if (id === "darkdj_pause") {
        await player.pause();

        return interaction.followUp({
          content: "⏸️ Music paused.",
          ephemeral: true
        });
      }

      if (id === "darkdj_resume") {
        await player.resume();

        return interaction.followUp({
          content: "▶️ Music resumed.",
          ephemeral: true
        });
      }

      if (id === "darkdj_skip") {
        await player.skip();

        return interaction.followUp({
          content: "⏭️ Skipped current song.",
          ephemeral: true
        });
      }

      if (id === "darkdj_shuffle") {
        const count = player.queue.tracks?.length || 0;

        if (count < 2) {
          return interaction.followUp({
            content: "At least 2 queued songs are needed to shuffle.",
            ephemeral: true
          });
        }

        await player.queue.shuffle();

        return interaction.followUp({
          content: `🔀 Shuffled ${count} queued songs.`,
          ephemeral: true
        });
      }

      if (id === "darkdj_stop") {
        await player.stopPlaying(true);

        return interaction.followUp({
          content: "⏹️ Music stopped and queue cleared. DARK DJ stays in voice.",
          ephemeral: true
        });
      }

      if (id === "darkdj_disconnect") {
        await player.stopPlaying(true);
        await player.destroy();

        return interaction.followUp({
          content: "🚪 DARK DJ left the voice channel.",
          ephemeral: true
        });
      }

      if (
        id === "darkdj_vol_down" ||
        id === "darkdj_vol_up"
      ) {
        const current = Number(player.volume) || 100;

        const next = id === "darkdj_vol_up"
          ? current + 10
          : current - 10;

        const applied = await setPlayerVolume(player, next);

        return interaction.followUp({
          content: `🎚️ Volume: **${applied}%**`,
          ephemeral: true
        });
      }

    } catch (error) {
      console.error("BUTTON ERROR:", error);

      try {
        await interaction.followUp({
          content: "Control failed. Check bot and Lavalink logs.",
          ephemeral: true
        });
      } catch (_) {}
    }

    return;
  }

  // ---------- SLASH COMMANDS ----------

  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  try {
    await interaction.deferReply();

    const name = interaction.commandName;
    const voice = getVoiceChannel(interaction);

    // PLAY

    if (name === "play") {
      if (!voice) {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "❌ Voice Channel Required",
              "Pehle voice channel join karo."
            )
          ]
        });
      }

      if (!client.lavalink.useable) {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "❌ Music Server Offline",
              "Lavalink node connected nahi hai. Thodi der baad try karo."
            )
          ]
        });
      }

      const player = await getOrCreatePlayer(
        interaction,
        voice
      );

      const query = interaction.options.getString("song");

      const result = await player.search(
        { query },
        interaction.user
      );

      const tracks = (result.tracks || []).slice(0, 10);

      if (!tracks.length) {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "❌ No Results",
              "Koi playable song nahi mila."
            )
          ]
        });
      }

      const sessionId = interaction.id;

      searchSessions.set(sessionId, {
        tracks,
        requesterId: interaction.user.id
      });

      setTimeout(() => {
        searchSessions.delete(sessionId);
      }, 120000);

      const options = tracks.map((track, index) => {
        const details = trackDetails(track);

        return new StringSelectMenuOptionBuilder()
          .setLabel(
            `${index + 1}. ${details.title}`.slice(0, 100)
          )
          .setDescription(
            `${details.author} • ${details.duration}`.slice(0, 100)
          )
          .setValue(String(index));
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`darkdj_search_${sessionId}`)
        .setPlaceholder("Choose a song")
        .addOptions(options);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "🔎 DARK DJ • Search Results",
            `Found **${tracks.length}** songs for **${query}**.\nSelect one song from the menu.`
          )
        ],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    // JOIN

    if (name === "join") {
      if (!voice) {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "❌ Voice Required",
              "Pehle voice channel join karo."
            )
          ]
        });
      }

      await getOrCreatePlayer(interaction, voice);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "💙 DARK DJ Connected",
            `Connected to **${voice.name}**.`
          )
        ]
      });
    }

    // OTHER COMMANDS NEED AN EXISTING PLAYER

    const player = client.lavalink.getPlayer(
      interaction.guildId
    );

    if (!player || !player.connected) {
      return interaction.editReply({
        embeds: [
          makeEmbed(
            "❌ No Music Player",
            "Pehle `/play` ya `/join` use karo."
          )
        ]
      });
    }

    if (!voice || voice.id !== player.voiceChannelId) {
      return interaction.editReply({
        embeds: [
          makeEmbed(
            "❌ Wrong Voice Channel",
            "Bot ke same voice channel mein aao."
          )
        ]
      });
    }

    // PAUSE

    if (name === "pause") {
      await player.pause();

      return interaction.editReply({
        embeds: [makeEmbed("⏸️ Paused", "Music paused.")]
      });
    }

    // RESUME

    if (name === "resume") {
      await player.resume();

      return interaction.editReply({
        embeds: [makeEmbed("▶️ Resumed", "Music resumed.")]
      });
    }

    // SKIP

    if (name === "skip") {
      await player.skip();

      return interaction.editReply({
        embeds: [makeEmbed("⏭️ Skipped", "Moving to next song.")]
      });
    }

    // STOP - KEEP VOICE CONNECTION

    if (name === "stop") {
      await player.stopPlaying(true);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "⏹️ Stopped",
            "Queue cleared. DARK DJ is still connected."
          )
        ]
      });
    }

    // DISCONNECT - LEAVE VOICE

    if (name === "disconnect") {
      await player.stopPlaying(true);
      await player.destroy();

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "🚪 Disconnected",
            "DARK DJ left the voice channel."
          )
        ]
      });
    }

    // QUEUE

    if (name === "queue") {
      const current = player.queue.current;
      const tracks = player.queue.tracks || [];

      const list = tracks.slice(0, 10).map((track, index) => {
        const details = trackDetails(track);

        return (
          `**${index + 1}.** ${details.title} — ${details.duration}`
        );
      });

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "📜 DARK DJ • Queue",
            `**Now Playing:** ${
              current ? trackDetails(current).title : "Nothing"
            }\n\n` +
            (list.length ? list.join("\n") : "No upcoming songs.")
          )
        ]
      });
    }

    // VOLUME

    if (name === "volume") {
      const amount = interaction.options.getInteger("level");
      const applied = await setPlayerVolume(player, amount);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "🔊 Volume Updated",
            `Volume set to **${applied}%**.`
          )
        ]
      });
    }

  } catch (error) {
    console.error("COMMAND ERROR:", error);

    const message = {
      embeds: [
        makeEmbed(
          "❌ Error",
          "Command failed. Check bot and Lavalink logs."
        )
      ]
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({
        ...message,
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN);
      
