
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const MAX_VOLUME = 247;
const searchSessions = new Map();

client.on("error", error => console.error("CLIENT ERROR:", error));
process.on("unhandledRejection", error => console.error("UNHANDLED:", error));
process.on("uncaughtException", error => console.error("UNCAUGHT:", error));

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search and play a song")
    .addStringOption(o =>
      o.setName("song")
        .setDescription("Song name or link")
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
    .setDescription("Set volume")
    .addIntegerOption(o =>
      o.setName("level")
        .setDescription("Volume 1-247")
        .setMinValue(1)
        .setMaxValue(MAX_VOLUME)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set music loop mode")
    .addStringOption(o =>
      o.setName("mode")
        .setDescription("Choose loop mode")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Song", value: "song" },
          { name: "Queue", value: "queue" }
        )
    )
].map(c => c.toJSON());

function makeEmbed(title, description, color = 0x5865F2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "DARK DJ | Music System" });
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

function playerControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("darkdj_pause")
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_resume")
        .setLabel("Resume")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("darkdj_skip")
        .setLabel("Skip")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("darkdj_shuffle")
        .setLabel("Shuffle")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_stop")
        .setLabel("Stop")
        .setStyle(ButtonStyle.Danger)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("darkdj_vol_down")
        .setLabel("Volume -")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_vol_up")
        .setLabel("Volume +")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("darkdj_disconnect")
        .setLabel("Disconnect")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

async function getOrCreatePlayer(interaction, voice) {
  let player = client.lavalink.getPlayer(interaction.guildId);

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

async function setPlayerVolume(player, volume) {
  const safeVolume = Math.max(1, Math.min(MAX_VOLUME, Math.round(volume)));
  await player.setVolume(safeVolume);
  return safeVolume;
}

client.lavalink = new LavalinkManager({
  nodes: [
    {
      id: "DARK-DJ",
      host: process.env.LAVALINK_HOST,
      port: Number(process.env.LAVALINK_PORT || 443),
      authorization: process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE !== "false"
    }
  ],

  sendToShard: (guildId, payload) => {
    client.guilds.cache.get(guildId)?.shard?.send(payload);
  },

  autoSkip: true,

  playerOptions: {
    defaultSearchPlatform: "scsearch",
    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false
    }
  },

  client: {
    id: process.env.CLIENT_ID,
    username: "DARK DJ"
  }
});

client.on("raw", data => {
  client.lavalink.sendRawData(data);
});

client.lavalink.nodeManager.on("connect", node => {
  console.log("Lavalink connected:", node.id);
});

client.lavalink.nodeManager.on("error", (node, error) => {
  console.error("LAVALINK ERROR:", error);
});

client.lavalink.on("trackStart", (player, track) => {
  console.log("Now playing:", track?.info?.title);
});

client.lavalink.on("trackError", (player, track, payload) => {
  console.error("TRACK ERROR:", track?.info?.title, payload);
});

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

client.on("interactionCreate", async interaction => {

  // SEARCH MENU
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("darkdj_search_")
  ) {
    const sessionId = interaction.customId.slice("darkdj_search_".length);
    const session = searchSessions.get(sessionId);

    if (!session) {
      return interaction.reply({
        content: "This search has expired. Run /play again.",
        ephemeral: true
      });
    }

    if (interaction.user.id !== session.requesterId) {
      return interaction.reply({
        content: "Only the person who started this search can select a song.",
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    try {
      const selectedTrack = session.tracks[Number(interaction.values[0])];

      if (!selectedTrack) {
        return interaction.editReply({
          embeds: [makeEmbed("Song unavailable", "Run /play again.")],
          components: []
        });
      }

      const player = client.lavalink.getPlayer(interaction.guildId);

      if (!player) {
        return interaction.editReply({
          embeds: [makeEmbed("Player unavailable", "Run /play again.")],
          components: []
        });
      }

      player.queue.add(selectedTrack);

      if (!player.playing) {
        await player.play();
      }

      searchSessions.delete(sessionId);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "<:emoji_10:1570068905119195217> Added to DARK DJ",
            `**${selectedTrack.info.title}**\n` +
            `${selectedTrack.info.author || "Unknown artist"}\n` +
            `${durationText(selectedTrack.info.length)}\n\n` +
            `Requested by ${interaction.user}`
          )
        ],
        components: playerControls()
      });

    } catch (error) {
      console.error("SELECT MENU ERROR:", error);
      return interaction.followUp({
        content: "Could not add that song. Check bot and Lavalink logs.",
        ephemeral: true
      });
    }
  }

  // PLAYER BUTTONS
  if (interaction.isButton() && interaction.customId.startsWith("darkdj_")) {
    await interaction.deferUpdate();

    try {
      const player = client.lavalink.getPlayer(interaction.guildId);

      if (!player || !player.connected) {
        return interaction.followUp({
          content: "DARK DJ is not connected to voice.",
          ephemeral: true
        });
      }

      const id = interaction.customId;

      if (id === "darkdj_pause") {
        await player.pause();
        return interaction.followUp({ content: "Music paused.", ephemeral: true });
      }

      if (id === "darkdj_resume") {
        await player.resume();
        return interaction.followUp({ content: "Music resumed.", ephemeral: true });
      }

      if (id === "darkdj_skip") {
        await player.skip();
        return interaction.followUp({ content: "Song skipped.", ephemeral: true });
      }

      if (id === "darkdj_shuffle") {
        const count = await player.queue.shuffle();
        return interaction.followUp({
          content: count
            ? `Shuffled ${count} queued songs.`
            : "No queued songs to shuffle.",
          ephemeral: true
        });
      }

      if (id === "darkdj_stop") {
        await player.stopPlaying(true);
        return interaction.followUp({
          content: "Playback stopped. Queue cleared. Bot stays in voice.",
          ephemeral: true
        });
      }

      if (id === "darkdj_disconnect") {
        await player.stopPlaying(true);
        await player.destroy();
        return interaction.followUp({
          content: "DARK DJ disconnected.",
          ephemeral: true
        });
      }

      if (id === "darkdj_vol_down" || id === "darkdj_vol_up") {
        const current = Number(player.volume) || 100;
        const next = id === "darkdj_vol_up"
          ? current + 10
          : current - 10;

        const applied = await setPlayerVolume(player, next);

        return interaction.followUp({
          content: `Volume: **${applied}%**`,
          ephemeral: true
        });
      }

    } catch (error) {
      console.error("BUTTON ERROR:", error);
      return interaction.followUp({
        content: "Control failed. Check bot logs.",
        ephemeral: true
      });
    }
  }

  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.commandName;
    const voice = getVoiceChannel(interaction);

    if (name === "play" || name === "join") {
      if (!voice) {
        return interaction.editReply({
          embeds: [
            makeEmbed("Voice Channel Required", "Join a voice channel first.")
          ]
        });
      }

      const player = await getOrCreatePlayer(interaction, voice);

      if (name === "join") {
        return interaction.editReply({
          embeds: [
            makeEmbed("<:emoji_10:1570068905119195217> DARK DJ", `Joined **${voice.name}**!`)
          ]
        });
      }

      const query = interaction.options.getString("song", true);

      console.log("Searching song:", query);

      const result = await player.search({ query }, interaction.user);

      console.log("Search result:", result.loadType);

      if (!result.tracks?.length) {
        return interaction.editReply({
          embeds: [
            makeEmbed("No Results", "No playable SoundCloud results found.")
          ]
        });
      }

      const seen = new Set();

      const tracks = result.tracks.filter(track => {
        const key =
          `${track.info?.title || ""}::${track.info?.author || ""}`.toLowerCase();

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      }).slice(0, 10);

      const sessionId =
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

      searchSessions.set(sessionId, {
        tracks,
        requesterId: interaction.user.id
      });

      setTimeout(() => searchSessions.delete(sessionId), 120000);

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`darkdj_search_${sessionId}`)
        .setPlaceholder("Choose a song to play")
        .addOptions(
          tracks.map((track, index) => {
            const info = track.info || {};

            return new StringSelectMenuOptionBuilder()
              .setLabel((info.title || "Unknown title").slice(0, 100))
              .setDescription(
                `${info.author || "Unknown artist"} | ${durationText(info.length)}`.slice(0, 100)
              )
              .setValue(String(index));
          })
        );

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "DARK DJ | Search Results",
            `Found **${tracks.length}** songs for **${query}**.\nSelect one below to add it to the player.`
          )
        ],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    const player = client.lavalink.getPlayer(interaction.guildId);

    if (name === "disconnect") {
      if (!player) {
        return interaction.editReply({
          embeds: [makeEmbed("Not Connected", "DARK DJ is not connected.")]
        });
      }

      await player.stopPlaying(true);
      await player.destroy();

      return interaction.editReply({
        embeds: [makeEmbed("Disconnected", "DARK DJ left the voice channel.")]
      });
    }

    if (!player || !player.connected) {
      return interaction.editReply({
        embeds: [
          makeEmbed("No Music Player", "Use /play or /join first.")
        ]
      });
    }

    if (name === "pause") {
      await player.pause();
      return interaction.editReply({
        embeds: [makeEmbed("Music Paused", "Playback paused.")]
      });
    }

    if (name === "resume") {
      await player.resume();
      return interaction.editReply({
        embeds: [makeEmbed("Music Resumed", "Playback resumed.")]
      });
    }

    if (name === "skip") {
      await player.skip();
      return interaction.editReply({
        embeds: [makeEmbed("Skipped", "Moving to next song.")]
      });
    }

    if (name === "stop") {
      await player.stopPlaying(true);
      return interaction.editReply({
        embeds: [
          makeEmbed("Music Stopped", "Queue cleared. DARK DJ stays connected.")
        ]
      });
    }

    if (name === "volume") {
      const requested = interaction.options.getInteger("level", true);
      const applied = await setPlayerVolume(player, requested);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "Volume Updated",
            `Volume set to **${applied}%**. High volume may distort audio.`
          )
        ]
      });
    }

    if (name === "queue") {
      const current = player.queue.current;
      const tracks = player.queue.tracks.slice(0, 10);

      const list = tracks.length
        ? tracks.map((track, index) =>
            `**${index + 1}.** ${track.info?.title || "Unknown"} | ${track.info?.author || "Unknown artist"}`
          ).join("\n")
        : "No upcoming songs.";

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "DARK DJ Queue",
            `**Now Playing:** ${current?.info?.title || "Nothing"}\n\n**Up Next:**\n${list}`
          )
        ]
      });
    }

    if (name === "loop") {
      const mode = interaction.options.getString("mode", true);

      if (typeof player.setLoop !== "function") {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "Loop Not Supported",
              "Your installed lavalink-client version does not expose setLoop()."
            )
          ]
        });
      }

      const loopValue =
        mode === "song" ? "track" :
        mode === "queue" ? "queue" : "none";

      await player.setLoop(loopValue);

      return interaction.editReply({
        embeds: [
          makeEmbed("Loop Updated", `Loop mode set to **${mode.toUpperCase()}**.`)
        ]
      });
    }

  } catch (error) {
    console.error("COMMAND ERROR:", error);

    try {
      await interaction.editReply({
        embeds: [
          makeEmbed(
            "Command Error",
            "Command failed. Check ACLClouds and Lavalink logs."
          )
        ]
      });
    } catch (replyError) {
      console.error("REPLY ERROR:", replyError);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
