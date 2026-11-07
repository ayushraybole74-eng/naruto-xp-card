
const express = require("express");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

const BACKGROUND =
  "https://i.ibb.co/1JdK0mcg/file-000000002368821185ef318a9bff4641.png";

app.get("/", (req, res) => {
  res.send("Naruto XP Card API is running!");
});

app.get("/xp", async (req, res) => {
  try {
    const {
      avatar = "https://cdn.discordapp.com/embed/avatars/0.png",
      username = "Member",
      xp = "0",
      maxxp = "100",
      level = "1"
    } = req.query;

    const width = 1536;
    const height = 1024;

    const bgResponse = await fetch(BACKGROUND);
    if (!bgResponse.ok) throw new Error("Background failed");

    const background = Buffer.from(
      await bgResponse.arrayBuffer()
    );

    let avatarBuffer;

    try {
      const avatarResponse = await fetch(avatar);
      if (!avatarResponse.ok) throw new Error("Avatar failed");

      avatarBuffer = Buffer.from(
        await avatarResponse.arrayBuffer()
      );
    } catch {
      avatarBuffer = await sharp({
        create: {
          width: 360,
          height: 360,
          channels: 4,
          background: "#5865F2"
        }
      }).png().toBuffer();
    }

    const currentXP = Math.max(0, Number(xp) || 0);
    const maximumXP = Math.max(1, Number(maxxp) || 100);
    const currentLevel = Math.max(1, Number(level) || 1);

    const progress = Math.min(
      currentXP / maximumXP,
      1
    );

    const safeName = String(username)
      .replace(/[&<>"']/g, "")
      .slice(0, 20);

    const avatarSize = 360;

    const avatarCircle = await sharp(avatarBuffer)
      .resize(avatarSize, avatarSize, {
        fit: "cover",
        position: "centre"
      })
      .composite([{
        input: Buffer.from(`
          <svg width="360" height="360">
            <circle cx="180" cy="180" r="179" fill="white"/>
          </svg>
        `),
        blend: "dest-in"
      }])
      .png()
      .toBuffer();

    const barWidth = 708;
    const filledWidth = Math.round(barWidth * progress);

    const escapeXML = (value) =>
      value.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const overlay = Buffer.from(`
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="xpbar" x1="0" x2="1">
            <stop offset="0%" stop-color="#00aaff"/>
            <stop offset="100%" stop-color="#00ffff"/>
          </linearGradient>
        </defs>

        <!-- Username -->
        <text x="458" y="675"
          text-anchor="middle"
          font-size="48"
          font-weight="bold"
          fill="white">${escapeXML(safeName)}</text>

        <!-- XP progress -->
        <rect x="230" y="760"
          width="${barWidth}" height="60"
          rx="30"
          fill="#061b52"
          stroke="#00caff"
          stroke-width="3"/>

        <rect x="230" y="760"
          width="${filledWidth}" height="60"
          rx="30"
          fill="url(#xpbar)"/>

        <!-- XP amount -->
        <text x="950" y="810"
          text-anchor="end"
          font-size="42"
          font-weight="bold"
          fill="white">${currentXP}/${maximumXP}</text>

        <!-- Level -->
        <text x="665" y="925"
          text-anchor="middle"
          font-size="48"
          font-weight="bold"
          fill="white">Level ${currentLevel}</text>
      </svg>
    `);

    const image = await sharp(background)
      .resize(width, height, { fit: "fill" })
      .composite([
        {
          input: avatarCircle,
          left: 270,
          top: 205
        },
        {
          input: overlay,
          left: 0,
          top: 0
        }
      ])
      .png()
      .toBuffer();

    res.set("Content-Type", "image/png");
    res.send(image);

  } catch (error) {
    console.error(error);
    res.status(500).send("Image generation failed");
  }
});

app.listen(PORT, () => {
  console.log(`Naruto XP API running on port ${PORT}`);
});
