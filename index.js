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
  StringSelectMenuBuilder
} = require("discord.js");

const { LavalinkManager } = require("lavalink-client");
const crypto = require("node:crypto");

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const host = process.env.LAVALINK_HOST
  .replace(/^https?:\/\//, "")
  .replace(/^wss?:\/\//, "")
  .replace(/\/$/, "");

const port = Number(process.env.LAVALINK_PORT || 443);
const secure =
  String(process.env.LAVALINK_SECURE || "true").toLowerCase() === "true";

client.lavalink = new LavalinkManager({
  nodes: [
    {
      id: "DARK-DJ",
      host,
      port,
      authorization: process.env.LAVALINK_PASSWORD,
      secure
    }
  ],

  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },

  client: {
    id: process.env.CLIENT_ID,
    username: "DARK DJ"
  },

  autoSkip: true,

  playerOptions: {
    defaultSearchPlatform: "ytmsearch",
    clientBasedPositionUpdateInterval: 150,
    volumeDecrementer: 1,

    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false
    },

    onEmptyQueue: {
      destroyAfterMs: -1
    },

    useUnresolvedData: true
  },

  queueOptions: {
    maxPreviousTracks: 25
  }
});

const searchSessions = new Map();

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "Live";

  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function trackTitle(track) {
  return track?.info?.title || "Unknown track";
}

function makeNowPlayingEmbed(track, requester) {
  const info = track?.info || {};
  const url = info.uri;
  const title = trackTitle(track);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("🎶 Now Playing")
    .setDescription(url ? `[${title}](${url})` : title)
    .addFields(
      {
        name: "Artist",
        value: info.author || "Unknown",
        inline: true
      },
      {
        name: "Duration",
        value: formatTime(info.duration || info.length),
        inline: true
      },
      {
        name: "Requested By",
        value: requester
          ? `<@${requester.id || requester}>`
          : "Unknown",
        inline: true
      }
    )
    .setFooter({
      text: "DARK DJ • Music Player"
    });

  const image = info.artworkUrl || info.thumbnail;

  if (image) {
    embed.setThumbnail(image);
  }

  return embed;
}

function controlRows(guildId) {
  const first = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:pause`)
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:resume`)
      .setLabel("Resume")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:skip`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:shuffle`)
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:stop`)
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
  );

  const second = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:vol_down`)
      .setLabel("Volume -")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:vol_up`)
      .setLabel("Volume +")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`dj:${guildId}:disconnect`)
      .setLabel("Disconnect")
      .setStyle(ButtonStyle.Danger)
  );

  return [first, second];
}

async function getPlayer(interaction, connectIfNeeded = false) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    throw new Error("Pehle kisi voice channel me join karo.");
  }

  let player = client.lavalink.getPlayer(interaction.guildId);

  if (
    player &&
    player.voiceChannelId &&
    player.voiceChannelId !== voiceChannel.id
  ) {
    throw new Error(
      `Bot already <#${player.voiceChannelId}> me hai.`
    );
  }

  if (!player && connectIfNeeded) {
    player = await client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 100
    });
  }

  if (!player && !connectIfNeeded) {
    throw new Error(
      "Music player active nahi hai. Pehle /join ya /play use karo."
    );
  }

  if (connectIfNeeded && player && !player.connected) {
    player.voiceChannelId = voiceChannel.id;
    player.textChannelId = interaction.channelId;
  }

  if (connectIfNeeded && !player.connected) {
    await player.connect();
  }

  return player;
}

const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Bot ko aapke voice channel me join karaye"),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("YouTube Music par song search kare")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Song name ya link")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Current song pause kare"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Paused song resume kare"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Current song skip kare"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Song stop karke queue clear kare"),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Bot ko voice channel se disconnect kare"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Current music queue dekhe"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Music volume set kare")
    .addIntegerOption(option =>
      option
        .setName("level")
        .setDescription("Volume 1 se 247 tak")
        .setMinValue(1)
        .setMaxValue(247)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Loop mode set kare")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Song", value: "track" },
          { name: "Queue", value: "queue" }
        )
    )
].map(command => command.toJSON());

client.on("raw", packet => {
  client.lavalink.sendRawData(packet);
});

client.once("ready", async () => {
  console.log(`DARK DJ Online: ${client.user.tag}`);

  try {
    await client.lavalink.init({
      ...client.user
    });

    const rest = new REST({
      version: "10"
    }).setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("DARK DJ commands registered!");
  } catch (error) {
    console.error("Startup error:", error);
  }
});

// LAVALINK EVENTS

client.lavalink.nodeManager.on("connect", node => {
  console.log(`Lavalink connected: ${node.id}`);
});

client.lavalink.nodeManager.on("error", (node, error) => {
  console.error(
    `Lavalink node error (${node?.id || "unknown"}):`,
    error?.message || error
  );
});

client.lavalink.nodeManager.on("disconnect", (node, reason) => {
  console.error(
    `Lavalink disconnected (${node?.id || "unknown"}):`,
    reason || "No reason supplied"
  );
});

client.lavalink.on("trackStart", async (player, track) => {
  console.log(
    `[TRACK START] guild=${player.guildId} title=${trackTitle(track)}`
  );

  try {
    const channel = client.channels.cache.get(player.textChannelId);

    if (!channel || !channel.isTextBased()) return;

    const requester = track?.requester;

    await channel.send({
      embeds: [
        makeNowPlayingEmbed(track, requester)
      ],
      components: controlRows(player.guildId)
    });
  } catch (error) {
    console.error("Now Playing message error:", error);
  }
});

client.lavalink.on("trackError", (player, track, payload) => {
  console.error(
    `[TRACK ERROR] guild=${player?.guildId || "unknown"} title=${trackTitle(track)}`,
    payload
  );
});

client.lavalink.on("trackStuck", (player, track, payload) => {
  console.error(
    `[TRACK STUCK] guild=${player?.guildId || "unknown"} title=${trackTitle(track)}`,
    payload
  );
});

client.lavalink.on("trackEnd", (player, track, payload) => {
  console.log(
    `[TRACK END] guild=${player?.guildId || "unknown"} title=${trackTitle(track)}`,
    payload?.reason || "ended"
  );
});

client.lavalink.on("queueEnd", player => {
  console.log(
    `[QUEUE END] guild=${player?.guildId || "unknown"}`
  );
});

// INTERACTIONS

client.on("interactionCreate", async interaction => {
  try {

    // SEARCH SELECT MENU

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("djsearch:")
    ) {
      // Acknowledge immediately.
      await interaction.deferUpdate();

      const [, ownerId, sessionId] =
        interaction.customId.split(":");

      if (interaction.user.id !== ownerId) {
        return interaction.followUp({
          content: "Ye search menu kisi aur user ka hai.",
          ephemeral: true
        });
      }

      const session = searchSessions.get(sessionId);

      if (
        !session ||
        session.ownerId !== interaction.user.id
      ) {
        return interaction.followUp({
          content: "Search expire ho gaya. Dobara /play use karo.",
          ephemeral: true
        });
      }

      const selected = Number(interaction.values[0]);
      const track = session.tracks[selected];

      if (!track) {
        return interaction.editReply({
          content: "Selected song nahi mila. Dobara /play use karo.",
          embeds: [],
          components: []
        });
      }

      searchSessions.delete(sessionId);

      const voiceChannel = interaction.member?.voice?.channel;

      if (!voiceChannel) {
        return interaction.editReply({
          content: "Pehle voice channel me join karo.",
          embeds: [],
          components: []
        });
      }

      let player = client.lavalink.getPlayer(
        interaction.guildId
      );

      if (
        player &&
        player.voiceChannelId !== voiceChannel.id
      ) {
        return interaction.editReply({
          content: `Bot already <#${player.voiceChannelId}> me hai.`,
          embeds: [],
          components: []
        });
      }

      if (!player) {
        player = await client.lavalink.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: 100
        });
      }

      if (!player.connected) {
        await player.connect();
      }

      await player.queue.add(track);

      if (!player.playing && !player.paused) {
        await player.play();
      }

      return interaction.editReply({
        content: `Added to queue: **${trackTitle(track)}**`,
        embeds: [],
        components: []
      });
    }

    // PLAYER BUTTONS

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("dj:")
    ) {
      const [, guildId, action] =
        interaction.customId.split(":");

      if (guildId !== interaction.guildId) return;

      await interaction.deferReply({
        ephemeral: true
      });

      const player = client.lavalink.getPlayer(guildId);

      if (!player) {
        return interaction.editReply(
          "Music player active nahi hai."
        );
      }

      const memberVoice = interaction.member?.voice?.channel;

      if (
        !memberVoice ||
        memberVoice.id !== player.voiceChannelId
      ) {
        return interaction.editReply(
          "Controls use karne ke liye bot ke voice channel me raho."
        );
      }

      if (action === "pause") {
        await player.pause(true);
      }

      else if (action === "resume") {
        await player.pause(false);
      }

      else if (action === "skip") {
        await player.skip();
      }

      else if (action === "shuffle") {
        player.queue.shuffle();
      }

      else if (action === "stop") {
        await player.stopPlaying(true, false);
      }

      else if (action === "vol_down") {
        await player.setVolume(
          Math.max(1, (player.volume || 100) - 10)
        );
      }

      else if (action === "vol_up") {
        await player.setVolume(
          Math.min(247, (player.volume || 100) + 10)
        );
      }

      else if (action === "disconnect") {
        await player.destroy();

        return interaction.editReply(
          "DARK DJ voice channel se disconnect ho gaya."
        );
      }

      return interaction.editReply(
        `Done: ${action.replace("_", " ")}.`
      );
    }

    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    // ACKNOWLEDGE SLASH COMMANDS FIRST

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({
        ephemeral: true
      });
    }

    // PLAY

    if (name === "play") {
      const query = interaction.options.getString(
        "song",
        true
      );

      const voiceChannel = interaction.member?.voice?.channel;

      if (!voiceChannel) {
        return interaction.editReply(
          "Pehle kisi voice channel me join karo."
        );
      }

      let player = client.lavalink.getPlayer(
        interaction.guildId
      );

      if (
        player &&
        player.voiceChannelId !== voiceChannel.id
      ) {
        return interaction.editReply(
          `Bot already <#${player.voiceChannelId}> me hai.`
        );
      }

      if (!player) {
        player = await client.lavalink.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: 100
        });
      }

      if (!player.connected) {
        await player.connect();
      }

      const result = await player.search(
        {
          query,
          source: "ytmsearch"
        },
        interaction.user
      );

      const tracks = (result?.tracks || []).slice(0, 10);

      if (!tracks.length) {
        return interaction.editReply(
          "Koi playable result nahi mila. Dusra song name try karo."
        );
      }

      const sessionId = crypto.randomUUID();

      searchSessions.set(sessionId, {
        ownerId: interaction.user.id,
        tracks
      });

      const options = tracks.map((track, index) => ({
        label: `${index + 1}. ${trackTitle(track)}`.slice(0, 100),

        description: `${
          track.info?.author || "Unknown artist"
        } • ${
          formatTime(track.info?.duration || track.info?.length)
        }`.slice(0, 100),

        value: String(index)
      }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId(
          `djsearch:${interaction.user.id}:${sessionId}`
        )
        .setPlaceholder("Apna song select karo")
        .addOptions(options);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Search Results")
        .setDescription(
          tracks.map((track, index) =>
            `**${index + 1}.** ${trackTitle(track)} — ${
              track.info?.author || "Unknown"
            }`
          ).join("\n")
        )
        .setFooter({
          text: "Ye menu sirf search karne wale user ke liye hai."
        });

      return interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    // JOIN

    if (name === "join") {
      const player = await getPlayer(interaction, true);

      return interaction.editReply(
        `DARK DJ <#${player.voiceChannelId}> me join ho gaya.`
      );
    }

    // OTHER MUSIC COMMANDS

    if (
      name === "pause" ||
      name === "resume" ||
      name === "skip" ||
      name === "stop" ||
      name === "disconnect" ||
      name === "queue" ||
      name === "volume" ||
      name === "loop"
    ) {
      const player = await getPlayer(interaction, false);

      if (name === "pause") {
        await player.pause(true);

        return interaction.editReply(
          "Song pause kar diya."
        );
      }

      if (name === "resume") {
        await player.pause(false);

        return interaction.editReply(
          "Song resume kar diya."
        );
      }

      if (name === "skip") {
        await player.skip();

        return interaction.editReply(
          "Song skip kar diya."
        );
      }

      if (name === "stop") {
        await player.stopPlaying(true, false);

        return interaction.editReply(
          "Playback stop aur queue clear kar di. Bot voice me rahega."
        );
      }

      if (name === "disconnect") {
        await player.destroy();

        return interaction.editReply(
          "DARK DJ voice channel se disconnect ho gaya."
        );
      }

      if (name === "volume") {
        const level = interaction.options.getInteger(
          "level",
          true
        );

        await player.setVolume(level);

        return interaction.editReply(
          `Volume **${level}%** set kar diya. 100% se upar audio distort ho sakta hai.`
        );
      }

      if (name === "loop") {
        const mode = interaction.options.getString(
          "mode",
          true
        );

        await player.setRepeatMode(mode);

        return interaction.editReply(
          `Loop mode: **${mode}**`
        );
      }

      if (name === "queue") {
        const current = player.queue.current;

        const tracks = Array.isArray(player.queue.tracks)
          ? player.queue.tracks
          : [];

        const upcoming = tracks.slice(0, 15);

        const lines = upcoming.map((track, index) =>
          `**${index + 1}.** ${trackTitle(track)} \`[${formatTime(
            track.info?.duration || track.info?.length
          )}]\``
        );

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("Music Queue")
          .setDescription(
            `${
              current
                ? `**Now Playing:** ${trackTitle(current)}\n\n`
                : ""
            }` +
            (
              lines.length
                ? lines.join("\n")
                : "Queue me aur songs nahi hain."
            )
          )
          .setFooter({
            text: `Upcoming tracks: ${tracks.length}`
          });

        return interaction.editReply({
          embeds: [embed]
        });
      }
    }

  } catch (error) {
    console.error("INTERACTION ERROR:", error);

    const message = error?.message || "Unexpected error.";

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({
        content: `Error: ${message}`,
        ephemeral: true
      }).catch(() => {});
    }

    return interaction.repl
