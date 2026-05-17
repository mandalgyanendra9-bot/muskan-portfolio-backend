const express = require("express");
const router = express.Router();

const upload = require("../middleware/Upload");
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/User");

router.post(
  "/dp",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const imageUrl = `/uploads/${req.file.filename}`;
      
      // Update User in DB
      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { profileImage: imageUrl },
        { new: true }
      );

      res.json({
        message: "DP Uploaded Successfully",
        file: req.file,
        imageUrl: imageUrl,
        user: updatedUser
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({
        message: "Upload Failed",
      });
    }
  }
);

module.exports = router;