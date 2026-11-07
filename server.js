
const express = require("express");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

const BACKGROUND =
  "https://i.ibb.co/RpTdCFz6/file-00000000453c821183c32637c23f63a0.png";

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

    const width = 1648;
    const height = 1024;

    const bgResponse = await fetch(BACKGROUND);
    if (!bgResponse.ok) throw new Error("Background image failed");

    const background = Buffer.from(await bgResponse.arrayBuffer());

    let avatarBuffer;
    try {
      const avatarResponse = await fetch(avatar);
      if (!avatarResponse.ok) throw new Error("Avatar failed");
      avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());
    } catch {
      avatarBuffer = await sharp({
        create: {
          width: 340,
          height: 340,
          channels: 4,
          background: "#5865F2"
        }
      }).png().toBuffer();
    }

    const currentXP = Math.max(0, Number(xp) || 0);
    const maximumXP = Math.max(1, Number(maxxp) || 100);
    const progress = Math.min(currentXP / maximumXP, 1);

    const safeName = String(username)
      .replace(/[&<>"']/g, "")
      .slice(0, 22);

    const avatarCircle = await sharp(avatarBuffer)
      .resize(340, 340, { fit: "cover" })
      .composite([{
        input: Buffer.from(
          '<svg width="340" height="340"><circle cx="170" cy="170" r="169" fill="white"/></svg>'
        ),
        blend: "dest-in"
      }])
      .png()
      .toBuffer();

    const xpWidth = Math.round(375 * progress);

    const overlay = Buffer.from(`
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="bar" x1="0" x2="1">
            <stop offset="0%" stop-color="#00aaff"/>
            <stop offset="100%" stop-color="#00ffff"/>
          </linearGradient>
        </defs>

        <rect x="315" y="705" width="575" height="78"
          rx="8" fill="#06123c"/>
        <rect x="328" y="737" width="375" height="40"
          rx="20" fill="#071b53" stroke="#00caff" stroke-width="2"/>
        <rect x="328" y="737" width="${xpWidth}" height="40"
          rx="20" fill="url(#bar)"/>

        <text x="720" y="776" font-size="49" font-weight="bold"
          fill="white">${currentXP}/${maximumXP}</text>

        <rect x="600" y="817" width="300" height="75"
          rx="20" fill="#06123c"/>

        <text x="735" y="869" font-size="43" font-weight="bold"
          text-anchor="middle" fill="#ffffff">Level ${Number(level) || 1}</text>

        <text x="330" y="627" font-size="43" font-weight="bold"
          text-anchor="middle" fill="#ffffff">${safeName}</text>
      </svg>
    `);

    const image = await sharp(background)
      .resize(width, height, { fit: "fill" })
      .composite([
        { input: avatarCircle, left: 153, top: 190 },
        { input: overlay, left: 0, top: 0 }
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
  console.log(`XP Card API running on port ${PORT}`);
});
