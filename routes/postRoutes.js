const express = require("express");
const router = express.Router();
const Post = require("../models/Post");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../middleware/Upload");

// GET ALL POSTS
router.get("/", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET SINGLE POST
router.get("/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    res.json(post);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE POST (Admin)
router.post("/", authMiddleware, adminMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { title, content, excerpt, category } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;
    const post = await Post.create({ title, content, excerpt, category, image });
    res.status(201).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE POST (Admin)
router.put("/:id", authMiddleware, adminMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { title, content, excerpt, category } = req.body;
    const updateData = { title, content, excerpt, category };
    if (req.file) updateData.image = `/uploads/${req.file.filename}`;
    
    const post = await Post.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE POST (Admin)
router.delete("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Post deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
