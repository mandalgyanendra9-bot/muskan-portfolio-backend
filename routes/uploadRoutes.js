const express = require("express");
const router = express.Router();

const upload = require("../middleware/Upload");
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/User");
const { serializeUser } = require("../utils/userResponse");
const { uploadProfilePhoto, setProfilePhotoFields } = require("../utils/profilePhoto");

router.post(
  "/dp",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const imageUrl = await uploadProfilePhoto(req.file);
      
      // Update User in DB
      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        setProfilePhotoFields({}, imageUrl),
        { new: true }
      );

      res.json({
        message: "DP Uploaded Successfully",
        file: req.file,
        imageUrl,
        profilePhotoUrl: imageUrl,
        user: serializeUser(updatedUser, req),
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
