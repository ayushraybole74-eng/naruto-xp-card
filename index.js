
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

// ===================================
// ENVIRONMENT
// ===================================

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

// ===================================
// STORAGE
// ===================================

const searchSessions = new Map();
const buttonLocks = new Set();

let lavalinkNodeReady = false;
const lavalinkWaiters = new Set();

// ===================================
// LAVALINK
// ===================================

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

// ===================================
// WAIT FOR LAVALINK
// ===================================

function waitForLavalink(timeoutMs = 20000) {
  if (lavalinkNodeReady) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      lavalinkWaiters.delete(onReady);
      resolve();
    };

    const timer = setTimeout(() => {
      lavalinkWaiters.delete(onReady);
      reject(new Error("Lavalink connect nahi hua. Dobara try karo."));
    }, timeoutMs);

    lavalinkWaiters.add(onReady);
  });
}

// ===================================
// HELPERS
// ===================================

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "Live";
  }

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

function trackUrl(track) {
  return track?.info?.uri || "";
}

function trackDuration(track) {
  return track?.info?.duration || track?.info?.length || 0;
}

function getTrackImage(track) {
  return (
    track?.info?.artworkUrl ||
    track?.info?.thumbnail ||
    null
  );
}

function getRequesterText(requester) {
  if (!requester) return "Unknown";

  return requester.id
    ? `<@${requester.id}>`
    : `<@${requester}>`;
}

function makeTrackRequester(track, requester) {
  track.requester = requester;
  return track;
}

async function safeEditReply(interaction, content) {
  try {
    if (!interaction.isRepliable()) return;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({
        content,
        ephemeral: true
      });
    }
  } catch (error) {
    if (error.code !== 10062 && error.code !== 40060) {
      console.error("Reply error:", error);
    }
  }
}

// ===================================
// NOW PLAYING EMBED
// ===================================

function makeNowPlayingEmbed(track, requester) {
  const url = trackUrl(track);
  const title = trackTitle(track);

  const songLine = url
    ? `・[${title}](${url})`
    : `・${title}`;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("<:emoji_10:1570068905119195217> Now Playing")
    .setDescription(songLine)
    .addFields(
      {
        name: "Duration",
        value: formatTime(trackDuration(track)),
        inline: true
      },
      {
        name: "Requestor",
        value: getRequesterText(requester),
        inline: true
      }
    )
    .setFooter({
      text: "DARK DJ • Music Player"
    });

  const image = getTrackImage(track);

  if (image) {
    embed.setThumbnail(image);
  }

  return embed;
}

// ===================================
// ENQUEUED EMBED
// ===================================

function makeEnqueuedEmbed(track, requester, position) {
  const url = trackUrl(track);
  const title = trackTitle(track);

  const songName = url
    ? `[${title}](${url})`
    : title;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("<:emoji_10:1570068905119195217> Enqueued Track")
    .setDescription(
      `<:emoji_11:1570264742826606693> **${songName}** added to the queue`
    )
    .addFields(
      {
        name: "Duration",
        value: formatTime(trackDuration(track)),
        inline: true
      },
      {
        name: "Requestor",
        value: getRequesterText(requester),
        inline: true
      },
      {
        name: "Position",
        value: `#${position}`,
        inline: true
      }
    )
    .setFooter({
      text: "DARK DJ • Music System"
    });

  const image = getTrackImage(track);

  if (image) {
    embed.setThumbnail(image);
  }

  return embed;
}

// ===================================
// PLAYER BUTTONS
// ===================================

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

// ===================================
// PLAYER SYSTEM
// ===================================

async function getPlayer(interaction, connectIfNeeded = false) {
  const voiceChannel = interaction.member?.voice?.channel;

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

  if (!player) {
    throw new Error("Music player active nahi hai. Pehle /join use karo.");
  }

  if (connectIfNeeded && !player.connected) {
    await player.connect();
  }

  return player;
}

async function addTrackToQueue(player, track, requester) {
  makeTrackRequester(track, requester);

  const position =
    (player.queue.tracks?.length || 0) +
    (player.playing || player.paused ? 2 : 1);

  await player.queue.add(track);

  if (!player.playing && !player.paused) {
    await player.play();
  }

  return position;
}

// ===================================
// SLASH COMMANDS
// ===================================

const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Bot ko voice channel me join karaye"),

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

// ===================================
// RAW DISCORD EVENTS
// ===================================

client.on("raw", packet => {
  try {
    client.lavalink.sendRawData(packet);
  } catch (error) {
    console.error("Raw event error:", error);
  }
});

// ===================================
// BOT READY
// ===================================

client.once("ready", async () => {
  console.log(`DARK DJ Online: ${client.user.tag}`);

  try {
    await client.lavalink.init({ ...client.user });

    const rest = new REST({ version: "10" })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("DARK DJ commands registered!");
  } catch (error) {
    console.error("Startup error:", error);
  }
});

// ===================================
// LAVALINK NODE EVENTS
// ===================================

client.lavalink.nodeManager.on("connect", node => {
  lavalinkNodeReady = true;

  console.log(`Lavalink connected: ${node.id}`);

  for (const resolve of [...lavalinkWaiters]) {
    resolve();
  }
});

client.lavalink.nodeManager.on("error", (node, error) => {
  console.error(
    `Lavalink node error (${node?.id || "unknown"}):`,
    error?.message || error
  );
});

client.lavalink.nodeManager.on("disconnect", (node, reason) => {
  lavalinkNodeReady = false;

  console.error(
    `Lavalink disconnected (${node?.id || "unknown"}):`,
    reason || "No reason supplied"
  );
});

// ===================================
// NOW PLAYING EVENT
// ===================================

client.lavalink.on("trackStart", async (player, track) => {
  console.log(
    `[TRACK START] guild=${player.guildId} title=${trackTitle(track)}`
  );

  try {
    const channel = client.channels.cache.get(player.textChannelId);

    if (!channel || !channel.isTextBased()) return;

    await channel.send({
      embeds: [
        makeNowPlayingEmbed(track, track?.requester)
      ],
      components: controlRows(player.guildId)
    });
  } catch (error) {
    console.error("Now Playing message error:", error);
  }
});

// ===================================
// TRACK EVENTS
// ===================================

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
  console.log(`[QUEUE END] guild=${player?.guildId || "unknown"}`);
});

// ===================================
// INTERACTION HANDLER
// ===================================

client.on("interactionCreate", async interaction => {
  try {

    // ===================================
    // SEARCH MENU
    // ===================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("djsearch:")
    ) {
      const [, ownerId, sessionId] =
        interaction.customId.split(":");

      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: "Ye search menu kisi aur user ka hai.",
          ephemeral: true
        });
      }

      await interaction.deferUpdate();

      const session = searchSessions.get(sessionId);

      if (!session || session.ownerId !== interaction.user.id) {
        return interaction.editReply({
          content: "Search expire ho gaya. Dobara /play use karo.",
          embeds: [],
          components: []
        });
      }

      const selected = Number(interaction.values[0]);
      const track = session.tracks[selected];

      if (!track) {
        return interaction.editReply({
          content: "Selected song nahi mila.",
          embeds: [],
          components: []
        });
      }

      searchSessions.delete(sessionId);

      await waitForLavalink();

      const player = await getPlayer(interaction, true);

      const position = await addTrackToQueue(
        player,
        track,
        interaction.user
      );

      await interaction.editReply({
        content: "Song selected.",
        embeds: [],
        components: []
      });

      const publicChannel =
        client.channels.cache.get(interaction.channelId);

      if (publicChannel?.isTextBased()) {
        await publicChannel.send({
          embeds: [
            makeEnqueuedEmbed(
              track,
              interaction.user,
              position
            )
          ]
        });
      }

      return;
    }

    // ===================================
    // PLAYER BUTTONS
    // ===================================

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

      if (buttonLocks.has(guildId)) {
        return interaction.editReply({
          content: "Ek control action already process ho raha hai."
        });
      }

      buttonLocks.add(guildId);

      try {
        await waitForLavalink();

        const player = client.lavalink.getPlayer(guildId);

        if (!player) {
          return interaction.editReply({
            content: "Music player active nahi hai."
          });
        }

        const memberVoice =
          interaction.member?.voice?.channel;

        if (
          !memberVoice ||
          memberVoice.id !== player.voiceChannelId
        ) {
          return interaction.editReply({
            content: "Controls use karne ke liye bot ke voice channel me raho."
          });
        }

        if (action === "pause") {
          if (player.paused) {
            return interaction.editReply({
              content: "Song already paused hai."
            });
          }

          await player.pause(true);
        }

        else if (action === "resume") {
          if (!player.paused) {
            return interaction.editReply({
              content: "Song already playing hai."
            });
          }

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

          return interaction.editReply({
            content: "DARK DJ voice channel se disconnect ho gaya."
          });
        }

        return interaction.editReply({
          content: `Done: ${action.replace("_", " ")}.`
        });

      } finally {
        buttonLocks.delete(guildId);
      }
    }

    // ===================================
    // SLASH COMMANDS
    // ===================================

    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    await interaction.deferReply({
      ephemeral: true
    });

    await waitForLavalink();

    // ===================================
    // JOIN
    // ===================================

    if (name === "join") {
      const player = await getPlayer(interaction, true);

      return interaction.editReply({
        content: `DARK DJ <#${player.voiceChannelId}> me join ho gaya.`
      });
    }

    // ===================================
    // PLAY
    // ===================================

    if (name === "play") {
      const query =
        interaction.options.getString("song", true);

      const voiceChannel =
        interaction.member?.voice?.channel;

      if (!voiceChannel) {
        return interaction.editReply({
          content: "Pehle kisi voice channel me join karo."
        });
      }

      const player = await getPlayer(interaction, true);

      const result = await player.search(
        { query },
        interaction.user
      );

      const tracks = result?.tracks || [];

      if (!tracks.length) {
        return interaction.editReply({
          content: "Koi song nahi mila. Dusra naam try karo."
        });
      }

      // Single result: direct queue
      if (tracks.length === 1) {
        const track = tracks[0];

        const position = await addTrackToQueue(
          player,
          track,
          interaction.user
        );

        await interaction.editReply({
          content: "Song queue me add kar diya."
        });

        const channel =
          client.channels.cache.get(interaction.channelId);

              if (channel?.isTextBased()) {
          await channel.send({
            embeds: [
              makeEnqueuedEmbed(
                track,
                interaction.user,
                position
              )
            ]
          });
        }

        return;
      }

      // Multiple search results
      const sessionId = crypto.randomUUID();

      searchSessions.set(sessionId, {
        ownerId: interaction.user.id,
        tracks: tracks.slice(0, 5)
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`djsearch:${interaction.user.id}:${sessionId}`)
        .setPlaceholder("Select a song")
        .addOptions(
          tracks.slice(0, 5).map((track, index) => ({
            label: trackTitle(track).slice(0, 100),
            description: `Duration: ${formatTime(trackDuration(track))}`.slice(0, 100),
            value: String(index)
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      return interaction.editReply({
        content: "Search results — apna song select karo:",
        components: [row]
      });
    }

    // OTHER PLAYER COMMANDS
    const player = await getPlayer(interaction, false);

    if (name === "pause") {
      if (player.paused) {
        return interaction.editReply({
          content: "Song already paused hai."
        });
      }

      await player.pause(true);

      return interaction.editReply({
        content: "Song pause kar diya."
      });
    }

    if (name === "resume") {
      if (!player.paused) {
        return interaction.editReply({
          content: "Song already playing hai."
        });
      }

      await player.pause(false);

      return interaction.editReply({
        content: "Song resume kar diya."
      });
    }

    if (name === "skip") {
      await player.skip();

      return interaction.editReply({
        content: "Song skip kar diya."
      });
    }

    if (name === "stop") {
      await player.stopPlaying(true, false);

      return interaction.editReply({
        content: "Playback stop aur queue clear kar di."
      });
    }

    if (name === "disconnect") {
      await player.destroy();

      return interaction.editReply({
        content: "DARK DJ disconnect ho gaya."
      });
    }

    if (name === "volume") {
      const level = interaction.options.getInteger("level", true);

      await player.setVolume(level);

      return interaction.editReply({
        content: `Volume ${level}% set kar diya.`
      });
    }

    if (name === "loop") {
      const mode = interaction.options.getString("mode", true);

      if (typeof player.setRepeatMode === "function") {
        await player.setRepeatMode(mode);
      } else if (typeof player.setLoop === "function") {
        await player.setLoop(mode);
      } else {
        throw new Error("Loop method available nahi hai.");
      }

      return interaction.editReply({
        content: `Loop mode: ${mode}`
      });
    }

    if (name === "queue") {
      const tracks = player.queue.tracks || [];
      const current = player.queue.current;

      if (!tracks.length && !current) {
        return interaction.editReply({
          content: "Queue abhi empty hai."
        });
      }

      let description = "";

      if (current) {
        description += `**Now Playing:**\n${trackTitle(current)}\n\n`;
      }

      if (tracks.length) {
        description += "**Up Next:**\n";

        description += tracks
          .slice(0, 10)
          .map((track, index) =>
            `**${index + 1}.** ${trackTitle(track)} — ${formatTime(trackDuration(track))}`
          )
          .join("\n");
      }

      if (tracks.length > 10) {
        description += `\n\nAnd ${tracks.length - 10} more songs...`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("DARK DJ • Music Queue")
        .setDescription(description.slice(0, 4000))
        .setFooter({
          text: `Total upcoming songs: ${tracks.length}`
        });

      return interaction.editReply({
        embeds: [embed]
      });
    }

  } catch (error) {
    console.error("COMMAND ERROR:", error);

    await safeEditReply(
      interaction,
      `Error: ${error.message || "Something went wrong."}`
    );
  }
});

// LOGIN
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("DISCORD LOGIN ERROR:", error);
});
