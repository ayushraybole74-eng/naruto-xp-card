const express = require("express");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Naruto XP Card API is running!");
});

app.get("/xp", async (req, res) => {
  try {
    res.json({
      status: "success",
      message: "XP Card API ready"
    });
  } catch (error) {
    res.status(500).json({ error: "Image generation failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
