
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
  MessageFlags,
  Events
} = require("discord.js");

const { LavalinkManager } = require("lavalink-client");

// ================= CONFIG =================

const MAX_VOLUME = 247;
const SEARCH_LIMIT = 10;
const sessions = new Map();
const nowPlayingMessages = new Map();
const refreshTimers = new Map();

const requiredEnv = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "LAVALINK_HOST",
  "LAVALINK_PASSWORD"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ================= LAVALINK =================

const host = process.env.LAVALINK_HOST
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const secure = process.env.LAVALINK_SECURE === "true";

client.lavalink = new LavalinkManager({
  nodes: [
    {
      id: "DARK-DJ",
      host,
      port: Number(process.env.LAVALINK_PORT || (secure ? 443 : 2333)),
      authorization: process.env.LAVALINK_PASSWORD,
      secure
    }
  ],

  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },

  autoSkip: true,

  client: {
    id: process.env.CLIENT_ID,
    username: "DARK DJ"
  },

  playerOptions: {
    defaultSearchPlatform: "ytmsearch",

    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false
    },

    onEmptyQueue: {
      destroyAfterMs: 86400000
    },

    useUnresolvedData: true
  }
});

// ================= SLASH COMMANDS =================

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search and play music")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Song name or URL")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the music"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the music"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and clear queue"),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Leave the voice channel"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the music queue"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Change music volume")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Volume from 0 to 247")
        .setMinValue(0)
        .setMaxValue(MAX_VOLUME)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Change loop mode")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Choose loop mode")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Song", value: "track" },
          { name: "Queue", value: "queue" }
        )
    )
].map(command => command.toJSON());

// ================= HELPERS =================

function formatTime(ms) {
  if (!ms || ms <= 0) return "LIVE";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel;
}

function getPlayer(guildId) {
  return client.lavalink.players.get(guildId);
}

async function getOrCreatePlayer(interaction) {
  const voice = getVoiceChannel(interaction);

  if (!voice) {
    throw new Error("Pehle kisi voice channel mein join karo.");
  }

  let player = getPlayer(interaction.guildId);

  if (player && player.voiceChannelId !== voice.id) {
    throw new Error("Bot already kisi aur voice channel mein hai.");
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

  player.textChannelId = interaction.channelId;

  if (!player.connected) {
    await player.connect();
  }

  return player;
}

function makeProgress(position, duration) {
  if (!duration || duration <= 0) {
    return "LIVE";
  }

  const total = 14;
  const filled = Math.min(
    total,
    Math.floor((position / duration) * total)
  );

  return (
    "▬".repeat(filled) +
    "🔘" +
    "▬".repeat(total - filled)
  );
}

function nowPlayingEmbed(player, track) {
  const info = track.info;
  const duration = info.duration || 0;
  const position = player.position || 0;

  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("DARK DJ • NOW PLAYING")
    .setDescription(
      `<:emoji_10:1570068905119195217> **[${info.title}](${info.uri || "https://www.youtube.com/"})**\n\n` +
      `**Artist:** ${info.author || "Unknown"}\n` +
      `**Duration:** ${formatTime(duration)}\n` +
      `**Requested by:** ${track.requester?.username || "Member"}\n\n` +
      `${makeProgress(position, duration)}\n` +
      `${formatTime(position)} / ${formatTime(duration)}`
    )
    .addFields({
      name: "Queue",
      value: `${player.queue.tracks.length} song(s) waiting`,
      inline: true
    })
    .setFooter({ text: "DARK DJ MUSIC SYSTEM" });

  const thumbnail = info.artworkUrl || info.thumbnail;

  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  return embed;
}

function controlRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("music_resume")
      .setLabel("Resume")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("music_skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("music_stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_vol_down")
      .setLabel("Volume -")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("music_vol_up")
      .setLabel("Volume +")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("music_disconnect")
      .setLabel("Disconnect")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function updateNowPlaying(guildId) {
  const player = getPlayer(guildId);
  const message = nowPlayingMessages.get(guildId);

  if (!player || !message) return;

  const track = player.queue.current;

  if (!track) return;

  try {
    await message.edit({
      embeds: [nowPlayingEmbed(player, track)],
      components: controlRows()
    });
  } catch (error) {
    console.log("Now Playing update:", error.message);
  }
}

async function publishNowPlaying(player, track) {
  const channel = await client.channels.fetch(player.textChannelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const guildId = player.guildId;
  const oldMessage = nowPlayingMessages.get(guildId);

  const payload = {
    embeds: [nowPlayingEmbed(player, track)],
    components: controlRows()
  };

  try {
    let message;

    if (oldMessage) {
      message = await oldMessage.edit(payload).catch(() => null);
    }

    if (!message) {
      message = await channel.send(payload);
    }

    nowPlayingMessages.set(guildId, message);

    if (refreshTimers.has(guildId)) {
      clearInterval(refreshTimers.get(guildId));
    }

    const timer = setInterval(() => {
      updateNowPlaying(guildId);
    }, 15000);

    refreshTimers.set(guildId, timer);
  } catch (error) {
    console.log("Now Playing error:", error.message);
  }
}

async function checkSameVoice(interaction, player) {
  const voice = getVoiceChannel(interaction);

  if (!voice) {
    await interaction.reply({
      content: "Pehle voice channel join karo.",
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  if (player && voice.id !== player.voiceChannelId) {
    await interaction.reply({
      content: "Bot ke voice channel mein aakar use karo.",
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  return true;
}

function uniqueTracks(tracks) {
  const seen = new Set();

  return tracks.filter(track => {
    const key =
      track.info.identifier ||
      track.info.uri ||
      track.info.title;

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  }).slice(0, SEARCH_LIMIT);
}

// ================= LAVALINK EVENTS =================

client.on("raw", packet => {
  client.lavalink.sendRawData(packet);
});

client.lavalink.on("trackStart", async (player, track) => {
  console.log("Now playing:", track.info.title);
  await publishNowPlaying(player, track);
});

client.lavalink.on("trackError", (player, track, payload) => {
  console.log(
    "Track error:",
    track?.info?.title,
    payload?.exception?.message || payload
  );
});

client.lavalink.on("trackStuck", (player, track, payload) => {
  console.log("Track stuck:", track?.info?.title, payload);
});

client.lavalink.on("queueEnd", async player => {
  const guildId = player.guildId;
  const message = nowPlayingMessages.get(guildId);

  if (refreshTimers.has(guildId)) {
    clearInterval(refreshTimers.get(guildId));
    refreshTimers.delete(guildId);
  }

  if (message) {
    await message.edit({
      embeds: [
        new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("DARK DJ • QUEUE FINISHED")
          .setDescription("Queue khatam ho gayi. Naya song play karne ke liye `/play` use karo.")
      ],
      components: []
    }).catch(() => {});
  }
});

// ================= READY =================

client.once(Events.ClientReady, async readyClient => {
  console.log(`DARK DJ Online: ${readyClient.user.tag}`);

  client.lavalink.init({
    id: readyClient.user.id,
    username: readyClient.user.username
  });

  try {
    const rest = new REST({ version: "10" })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("DARK DJ commands registered!");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

// ================= INTERACTIONS =================

client.on(Events.InteractionCreate, async interaction => {
  try {

    // -------- SEARCH SELECT MENU --------

    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("music_select_")) return;

      const sessionId = interaction.customId.replace(
        "music_select_",
        ""
      );

      const session = sessions.get(sessionId);

      if (!session) {
        return interaction.reply({
          content: "Search expire ho gaya. Dobara `/play` karo.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.user.id !== session.userId) {
        return interaction.reply({
          content: "Ye search menu kisi aur user ka hai.",
          flags: MessageFlags.Ephemeral
        });
      }

      const selected = session.tracks[
        Number(interaction.values[0])
      ];

      if (!selected) {
        return interaction.reply({
          content: "Song nahi mila. Dobara search karo.",
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferUpdate();

      const player = getPlayer(session.guildId);

      if (!player) {
        sessions.delete(sessionId);

        return interaction.editReply({
          content: "Player available nahi hai. Dobara `/play` karo.",
          embeds: [],
          components: []
        });
      }

      player.queue.add(selected);

      if (!player.playing && !player.paused) {
        await player.play();
      }

      sessions.delete(sessionId);

      return interaction.editReply({
        content: `**Added to queue:** ${selected.info.title}`,
        embeds: [],
        components: []
      });
    }

    // -------- MUSIC BUTTONS --------

    if (interaction.isButton()) {
      if (!interaction.customId.startsWith("music_")) return;

      const player = getPlayer(interaction.guildId);

      if (!player) {
        return interaction.reply({
          content: "Abhi koi music player active nahi hai.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (!await checkSameVoice(interaction, player)) return;

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      const action = interaction.customId;

      if (action === "music_pause") {
        if (!player.playing || player.paused) {
          return interaction.editReply("Music abhi play nahi ho raha.");
        }

        await player.pause();
        return interaction.editReply("Music paused.");
      }

      if (action === "music_resume") {
        if (!player.paused) {
          return interaction.editReply("Music paused nahi hai.");
        }

        await player.resume();
        return interaction.editReply("Music resumed.");
      }

      if (action === "music_skip") {
        if (!player.queue.current) {
          return interaction.editReply("Abhi koi song play nahi ho raha.");
        }

        await player.skip();
        return interaction.editReply("Song skipped.");
      }

      if (action === "music_shuffle") {
        if (player.queue.tracks.length < 2) {
          return interaction.editReply("Shuffle ke liye kam se kam 2 songs chahiye.");
        }

        await player.queue.shuffle();
        await updateNowPlaying(interaction.guildId);

        return interaction.editReply("Queue shuffled.");
      }

      if (action === "music_stop") {
        await player.stopPlaying(true, false);
        await updateNowPlaying(interaction.guildId);

        return interaction.editReply("Music stopped. Bot VC mein rahega.");
      }

      if (action === "music_vol_down") {
        const volume = Math.max(0, player.volume - 10);

        await player.setVolume(volume);
        return interaction.editReply(`Volume: ${volume}%`);
      }

      if (action === "music_vol_up") {
        const volume = Math.min(MAX_VOLUME, player.volume + 10);

        await player.setVolume(volume);
        return interaction.editReply(`Volume: ${volume}%`);
      }

      if (action === "music_disconnect") {
        await player.stopPlaying(true, false);
        await player.disconnect(true);

        if (refreshTimers.has(interaction.guildId)) {
          clearInterval(refreshTimers.get(interaction.guildId));
          refreshTimers.delete(interaction.guildId);
        }

        return interaction.editReply("DARK DJ disconnected.");
      }

      return;
    }

    // -------- SLASH COMMANDS --------

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    // PLAY

    if (command === "play") {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      const query = interaction.options.getString("song");
      const player = await getOrCreatePlayer(interaction);

      const result = await player.search(
        {
          query,
          source: "ytmsearch"
        },
        interaction.user
      );

      if (!result.tracks || result.tracks.length === 0) {
        return interaction.editReply(
          "Koi song nahi mila. Dusra naam try karo."
        );
      }

      const tracks = uniqueTracks(result.tracks);

      if (!tracks.length) {
        return interaction.editReply("Koi unique result nahi mila.");
      }

      const sessionId = Math.random().toString(36).slice(2, 10);

      sessions.set(sessionId, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        tracks
      });

      setTimeout(() => {
        sessions.delete(sessionId);
      }, 120000);

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`music_select_${sessionId}`)
        .setPlaceholder("Choose a song")
        .addOptions(
          tracks.map((track, index) => ({
            label: track.info.title.slice(0, 100),
            description: (
              `${track.info.author || "Unknown"} • ` +
              `${formatTime(track.info.duration)}`
            ).slice(0, 100),
            value: String(index)
          }))
        );

      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("DARK DJ • SEARCH RESULTS")
        .setDescription(
          `Search: **${query}**\n\n` +
          tracks.map((track, index) =>
            `**${index + 1}.** ${track.info.title}`
          ).join("\n")
        )
        .setFooter({
          text: "Select a song below • Only you can use this menu"
        });

      return interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    // JOIN

    if (command === "join") {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      const player = await getOrCreatePlayer(interaction);

      return interaction.editReply(
        `DARK DJ joined <#${player.voiceChannelId}>.`
      );
    }

    const player = getPlayer(interaction.guildId);

    // PAUSE / RESUME / SKIP / STOP / DISCONNECT / QUEUE / VOLUME / LOOP

    if (command !== "join" && !player) {
      return interaction.reply({
        content: "Pehle `/play` ya `/join` use karo.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (!await checkSameVoice(interaction, player)) return;

    if (command === "pause") {
      if (!player.playing || player.paused) {
        return interaction.reply({
          content: "Music abhi play nahi ho raha.",
          flags: MessageFlags.Ephemeral
        });
      }

      await player.pause();

      return interaction.reply({
        content: "Music paused.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === "resume") {
      if (!player.paused) {
        return interaction.reply({
          content: "Music paused nahi hai.",
          flags: MessageFlags.Ephemeral
        });
      }

      await player.resume();

      return interaction.reply({
        content: "Music resumed.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === "skip") {
      if (!player.queue.current) {
        return interaction.reply({
          content: "Abhi koi song play nahi ho raha.",
          flags: MessageFlags.Ephemeral
        });
      }

      await player.skip();

      return interaction.reply({
        content: "Song skipped.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === "stop") {
      await player.stopPlaying(true, false);

      return interaction.reply({
        content: "Music stopped and queue cleared. Bot VC mein rahega.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === "disconnect") {
      await player.stopPlaying(true, false);
      await player.disconnect(true);

      if (refreshTimers.has(interaction.guildId)) {
        clearInterval(refreshTimers.get(interaction.guildId));
        refreshTimers.delete(interaction.guildId);
      }

      return interaction.reply({
      
