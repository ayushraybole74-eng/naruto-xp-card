
const express = require("express");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

const BACKGROUND =
  "https://i.ibb.co/vC6fQSDH/file-00000000c15481faa0db012c7114644f.png";

function escapeXML(value) {
  return String(value).replace(/[<>&"']/g, char => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;",
    '"': "&quot;", "'": "&apos;"
  })[char]);
}

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

    const bgResponse = await fetch(BACKGROUND);
    if (!bgResponse.ok) throw new Error("Background download failed");

    const bg = Buffer.from(await bgResponse.arrayBuffer());

    // Fixed canvas dimensions
    const width = 1536;
    const height = 1024;

    const background = await sharp(bg)
      .resize(width, height, { fit: "cover" })
      .png()
      .toBuffer();

    // Download avatar; use fallback if unavailable
    let avatarBuffer;

    try {
      const avatarURL = new URL(avatar);
      if (avatarURL.protocol !== "https:") throw new Error("HTTPS required");

      const response = await fetch(avatarURL, {
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) throw new Error("Avatar unavailable");

      avatarBuffer = Buffer.from(await response.arrayBuffer());
    } catch {
      avatarBuffer = Buffer.from(`
        <svg width="330" height="330">
          <circle cx="165" cy="165" r="165" fill="#164caa"/>
          <text x="165" y="190" font-size="90"
            text-anchor="middle" fill="white">?</text>
        </svg>
      `);
    }

    const avatarImage = await sharp(avatarBuffer)
      .resize(330, 330, { fit: "cover" })
      .png()
      .toBuffer();

    const name = escapeXML(username).slice(0, 24);
    const currentXP = Math.max(0, Number(xp) || 0);
    const maximumXP = Math.max(1, Number(maxxp) || 100);
    const currentLevel = Math.max(0, Number(level) || 0);
    const progress = Math.min(1, currentXP / maximumXP);

    const svg = `
    <svg width="${width}" height="${height}"
      viewBox="0 0 ${width} ${height}">
      <defs>
        <clipPath id="circle">
          <circle cx="315" cy="360" r="165"/>
        </clipPath>
      </defs>

      <image href="data:image/png;base64,${avatarImage.toString("base64")}"
        x="150" y="195" width="330" height="330"
        clip-path="url(#circle)"/>

      <text x="315" y="615" text-anchor="middle"
        font-size="48" fill="white" font-weight="bold">
        ${name}
      </text>

      <rect x="310" y="720" width="390" height="25"
        rx="12" fill="#073b83"/>

      <rect x="310" y="720" width="${390 * progress}" height="25"
        rx="12" fill="#00eaff"/>

      <text x="790" y="750" font-size="45"
        fill="white" font-weight="bold">
        ${currentXP}/${maximumXP}
      </text>

      <text x="760" y="835" font-size="45"
        fill="white" font-weight="bold">
        ${currentLevel}
      </text>
    </svg>`;

    const output = await sharp(background)
      .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
      .png()
      .toBuffer();

    res.type("png").send(output);

  } catch (error) {
    console.error("XP CARD ERROR:", error);
    res.status(500).send(error.message);
  }
});

app.listen(PORT, () => {
  console.log("Naruto XP API running on " + PORT);
});
