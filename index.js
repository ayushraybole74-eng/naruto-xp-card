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
const trackRequesters = new Map();
const progressTimers = new Map();

const YOUTUBE_MUSIC_EMOJI = "<:emoji_10:1570068905119195217>";

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

function progressBar(position, duration) {
  if (!duration || duration <= 0) return "LIVE";

  const totalBlocks = 16;
  const progress = Math.max(0, Math.min(1, position / duration));
  const filled = Math.floor(progress * totalBlocks);

  return (
    "▬".repeat(filled) +
    "🔘" +
    "▬".repeat(Math.max(0, totalBlocks - filled))
  );
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

function trackKey(track) {
  return track?.info?.identifier ||
    track?.info?.uri ||
    track?.info?.title ||
    "unknown";
}

function makeNowPlayingEmbed(player, track) {
  const info = track?.info || {};
  const title = info.title || "Unknown title";
  const artist = info.author || "Unknown artist";
  const duration = Number(info.length) || 0;
  const position = Math.min(player.position || 0, duration || 0);

  const requester =
    trackRequesters.get(trackKey(track)) || "Unknown";

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(title)
    .setDescription(
      `${YOUTUBE_MUSIC_EMOJI} **YouTube Music**\n\n` +
      `**Artist**\n${artist}\n\n` +
      `**Progress**\n${progressBar(position, duration)}\n` +
      `${durationText(position)} / ${durationText(duration)}\n\n` +
      `**Requested by**\n${requester}\n\n` +
      `**Volume:** ${player.volume || 100}%`
    )
    .setFooter({ text: "DARK DJ • Now Playing" });

  if (info.uri) {
    embed.setURL(info.uri);
  }

  if (info.artworkUrl) {
    embed.setThumbnail(info.artworkUrl);
  } else if (info.thumbnail) {
    embed.setThumbnail(info.thumbnail);
  }

  return embed;
}

async function updateNowPlaying(player, track) {
  try {
    const channelId = player.getData("npChannelId");
    if (!channelId) return;

    const channel =
      client.channels.cache.get(channelId) ||
      await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = makeNowPlayingEmbed(player, track);
    let message = null;

    const messageId = player.getData("npMessageId");

    if (messageId) {
      message = await channel.messages.fetch(messageId).catch(() => null);
    }

    if (message) {
      await message.edit({
        embeds: [embed],
        components: playerControls()
      });
    } else {
      message = await channel.send({
        embeds: [embed],
        components: playerControls()
      });

      player.setData("npMessageId", message.id);
    }
  } catch (error) {
    console.error("NOW PLAYING ERROR:", error);
  }
}

function startProgressUpdater(player, track) {
  const guildId = player.guildId;

  if (progressTimers.has(guildId)) {
    clearInterval(progressTimers.get(guildId));
  }

  const timer = setInterval(async () => {
    if (!player.playing || !player.queue.current) return;

    await updateNowPlaying(player, player.queue.current);
  }, 15000);

  progressTimers.set(guildId, timer);
}

function stopProgressUpdater(guildId) {
  const timer = progressTimers.get(guildId);

  if (timer) {
    clearInterval(timer);
    progressTimers.delete(guildId);
  }
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
    defaultSearchPlatform: "ytmsearch",
    clientBasedPositionUpdateInterval: 150,
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

client.lavalink.on("trackStart", async (player, track) => {
  console.log("Now playing:", track?.info?.title);

  await updateNowPlaying(player, track);
  startProgressUpdater(player, track);
});

client.lavalink.on("trackEnd", player => {
  stopProgressUpdater(player.guildId);
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
    const sessionId =
      interaction.customId.slice("darkdj_search_".length);

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
      const selectedTrack =
        session.tracks[Number(interaction.values[0])];

      if (!selectedTrack) {
        return interaction.editReply({
          embeds: [makeEmbed("Song unavailable", "Run /play again.")],
          components: []
        });
      }

      const player =
        client.lavalink.getPlayer(interaction.guildId);

      if (!player) {
        return interaction.editReply({
          embeds: [makeEmbed("Player unavailable", "Run /play again.")],
          components: []
        });
      }

      player.setData("npChannelId", interaction.channelId);

      trackRequesters.set(
        trackKey(selectedTrack),
        `<@${interaction.user.id}>`
      );

      player.queue.add(selectedTrack);

      searchSessions.delete(sessionId);

      if (!player.playing) {
        await player.play();
      }

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "Added to DARK DJ",
            `**${selectedTrack.info.title}**\n` +
            `Artist: ${selectedTrack.info.author || "Unknown artist"}\n` +
            `Duration: ${durationText(selectedTrack.info.length)}\n\n` +
            "Your song has been added to the player."
          )
        ],
        components: []
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
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("darkdj_")
  ) {
    await interaction.deferUpdate();

    try {
      const player =
        client.lavalink.getPlayer(interaction.guildId);

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
          content: "Music paused.",
          ephemeral: true
        });
      }

      if (id === "darkdj_resume") {
        await player.resume();
        return interaction.followUp({
          content: "Music resumed.",
          ephemeral: true
        });
      }

      if (id === "darkdj_skip") {
        await player.skip();
        return interaction.followUp({
          content: "Song skipped.",
          ephemeral: true
        });
      }

      if (id === "darkdj_shuffle") {
        await player.queue.shuffle();

        return interaction.followUp({
          content: "Queue shuffled.",
          ephemeral: true
        });
      }

      if (id === "darkdj_stop") {
        await player.stopPlaying(true);
        stopProgressUpdater(player.guildId);

        return interaction.followUp({
          content: "Playback stopped. Queue cleared. Bot stays in voice.",
          ephemeral: true
        });
      }

      if (id === "darkdj_disconnect") {
        await player.stopPlaying(true);
        stopProgressUpdater(player.guildId);
        await player.destroy();

        return interaction.followUp({
          content: "DARK DJ disconnected.",
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

    // PLAY AND JOIN
    if (name === "play" || name === "join") {
      if (!voice) {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "Voice Channel Required",
              "Join a voice channel first."
            )
          ]
        });
      }

      const player = await getOrCreatePlayer(interaction, voice);

      if (name === "join") {
        return interaction.editReply({
          embeds: [
            makeEmbed("DARK DJ", `Joined **${voice.name}**!`)
          ]
        });
      }

      const query = interaction.options.getString("song", true);

      console.log("Searching YouTube Music:", query);

      const result = await player.search(
        { query },
        interaction.user
      );

      console.log("Search result:", result.loadType);

      if (!result.tracks?.length) {
        return interaction.editReply({
          embeds: [
            makeEmbed(
              "No Results",
              "No playable YouTube Music results found."
            )
          ]
        });
      }

      const seen = new Set();

      const tracks = result.tracks.filter(track => {
        const key =
          `${track.info?.title || ""}::${track.info?.author || ""}`
            .toLowerCase();

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

      setTimeout(() => {
        searchSessions.delete(sessionId);
      }, 120000);

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`darkdj_search_${sessionId}`)
        .setPlaceholder("Choose a song to play")
        .addOptions(
          tracks.map((track, index) => {
            const info = track.info || {};

            return new StringSelectMenuOptionBuilder()
              .setLabel(
                (info.title || "Unknown title").slice(0, 100)
              )
              .setDescription(
                `${info.author || "Unknown artist"} • ${durationText(info.length)}`
                  .slice(0, 100)
              )
              .setValue(String(index));
          })
        );

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "DARK DJ • Search Results",
            `Found **${tracks.length}** songs for **${query}**.\nSelect one below to add it to the player.`
          )
        ],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    const player =
      client.lavalink.getPlayer(interaction.guildId);

    if (name === "disconnect") {
      if (!player) {
        return interaction.editReply({
          embeds: [
            makeEmbed("Not Connected", "DARK DJ is not connected.")
          ]
        });
      }

      await player.stopPlaying(true);
      stopProgressUpdater(player.guildId);
      await player.destroy();

      return interaction.editReply({
        embeds: [
          makeEmbed("Disconnected", "DARK DJ left the voice channel.")
        ]
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
      stopProgressUpdater(player.guildId);

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "Music Stopped",
            "Queue cleared. DARK DJ stays connected."
          )
        ]
      });
    }

    if (name === "volume") {
      const requested =
        interaction.options.getInteger("level", true);

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
            `**${index + 1}.** ${track.info?.title || "Unknown"} — ${track.info?.author || "Unknown artist"}`
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

    if (name =
