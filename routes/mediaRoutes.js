const express = require("express");
const fs = require("fs");
const router = express.Router();
const {
  createPrivateMediaUrl,
  normalizePrivateMediaPath,
  resolvePrivateMediaFilePath,
  verifyPrivateMediaRequest,
} = require("../utils/privateMedia");

router.get("/sign", async (req, res) => {
  try {
    const mediaPath = normalizePrivateMediaPath(req.query.path || req.body?.path || "");
    if (!mediaPath) {
      return res.status(400).json({ message: "Valid media path is required" });
    }

    const expiresIn = req.query.expiresIn || req.body?.expiresIn || 600;
    const url = createPrivateMediaUrl(mediaPath, expiresIn);
    const safeTtl = Math.max(60, Math.min(Number(expiresIn) || 600, 60 * 60));
    res.json({
      url,
      expiresAt: new Date(Date.now() + safeTtl * 1000).toISOString(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/private", async (req, res) => {
  try {
    const { path: mediaPath, exp, sig } = req.query;
    if (!verifyPrivateMediaRequest(mediaPath, exp, sig)) {
      return res.status(403).json({ message: "Expired or invalid media link" });
    }

    const filePath = resolvePrivateMediaFilePath(mediaPath);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Media file not found" });
    }

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
