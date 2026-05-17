const express = require("express");
const router = express.Router();
const Project = require("../models/Project");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/Upload");

// GET ALL PROJECTS
router.get("/", async (req, res) => {
  try {
    // Return projects WITHOUT liveLink for security
    const projects = await Project.find().select("-liveLink");
    res.json(projects);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// SECURE DEMO ACCESS (PRO LEVEL)
router.get("/:id/access", authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    
    if (!project.liveLink) {
      return res.status(404).json({ message: "Live Demo link is not configured for this project" });
    }
    
    res.json({ liveLink: project.liveLink });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADD PROJECT (Protected)
router.post("/", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { title, description, type, tech, liveLink, githubLink } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
    
    const newProject = await Project.create({
      title,
      description,
      type,
      tech: tech ? tech.split(",") : [],
      liveLink,
      githubLink,
      image: imageUrl,
    });

    res.status(201).json(newProject);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE PROJECT (Protected)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    res.json({ message: "Project deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE PROJECT (Protected)
router.put("/:id", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { title, description, type, tech, liveLink, githubLink } = req.body;
    const updateData = {
      title,
      description,
      type,
      tech: tech ? (Array.isArray(tech) ? tech : tech.split(",")) : [],
      liveLink,
      githubLink,
    };

    if (req.file) {
      updateData.image = `/uploads/${req.file.filename}`;
    }

    const updatedProject = await Project.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(updatedProject);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
