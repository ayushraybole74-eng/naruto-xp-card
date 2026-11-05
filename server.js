const express = require("express");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

const BACKGROUND =
"https://i.ibb.co/vC6fQSDH/file-00000000c15481faa0db012c7114644f.png";

app.get("/", (req, res) => {
  res.send("Naruto XP Card API is running!");
});

app.get("/xp", async (req, res) => {
  try {
    const {
      avatar,
      username = "Player",
      xp = 0,
      maxxp = 100,
      level = 1
    } = req.query;

    if (!avatar) {
      return res.status(400).send("Avatar URL is required");
    }

    const [bgResponse, avatarResponse] = await Promise.all([
      fetch(BACKGROUND),
      fetch(avatar)
    ]);

    if (!bgResponse.ok || !avatarResponse.ok) {
      throw new Error("Image download failed");
    }

    const bg = Buffer.from(await bgResponse.arrayBuffer());
    const av = Buffer.from(await avatarResponse.arrayBuffer());

    const avatarImage = await sharp(av)
      .resize(340, 340, { fit: "cover" })
      .png()
      .toBuffer();

    const name = String(username).replace(/[<>&"']/g, "");
    const currentXP = Math.max(0, Number(xp) || 0);
    const maximumXP = Math.max(1, Number(maxxp) || 100);
    const currentLevel = Math.max(0, Number(level) || 0);
    const progress = Math.min(1, currentXP / maximumXP);

    const svg = `
    <svg width="1536" height="1024">
      <defs>
        <clipPath id="circle">
          <circle cx="315" cy="360" r="165"/>
        </clipPath>
      </defs>

      <image href="data:image/png;base64,${avatarImage.toString("base64")}"
        x="150" y="195" width="330" height="330"
        clip-path="url(#circle)"/>

      <rect x="180" y="555" width="400" height="90"
        fill="#001b58" opacity="0.85"/>

      <text x="380" y="615" text-anchor="middle"
        font-size="48" fill="white" font-weight="bold">
        ${name.slice(0, 18)}
      </text>

      <rect x="310" y="720" width="390" height="25"
        rx="12" fill="#00cfff"/>

      <rect x="310" y="720" width="${390 * progress}" height="25"
        rx="12" fill="#00ffff"/>

      <text x="790" y="750" font-size="45"
        fill="white" font-weight="bold">
        ${currentXP}/${maximumXP}
      </text>

      <text x="760" y="835" font-size="45"
        fill="white" font-weight="bold">
        ${currentLevel}
      </text>
    </svg>`;

    const output = await sharp(bg)
      .composite([{ input: Buffer.from(svg) }])
      .png()
      .toBuffer();

    res.type("png").send(output);

  } catch (error) {
    console.error(error);
    res.status(500).send("Image generation failed");
  }
});

app.listen(PORT, () => {
  console.log("Naruto XP API running on " + PORT);
});
