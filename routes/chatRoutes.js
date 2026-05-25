const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/Upload");

const safeUserSelect = "name email profileImage title role";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toId = (value) => {
  if (!value) return "";
  if (value._id) return value._id.toString();
  return value.toString();
};

const populateMessage = (query) =>
  query.populate("sender", safeUserSelect).populate("recipient", safeUserSelect);

const emitUnreadCount = async (req, userId) => {
  const io = req.app.get("io");
  if (!io || !userId) return;
  const unread = await ChatMessage.countDocuments({ recipient: userId, isSeen: false });
  io.to(userId.toString()).emit("unreadUpdate", { unread });
};

router.get("/contacts", authMiddleware, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const recentMessages = await ChatMessage.find({
      $or: [{ sender: currentUserId }, { recipient: currentUserId }],
    })
      .sort({ createdAt: -1 })
      .limit(80)
      .lean();

    const recentContactIds = [];
    recentMessages.forEach((message) => {
      const otherId = toId(message.sender) === currentUserId ? toId(message.recipient) : toId(message.sender);
      if (otherId && !recentContactIds.includes(otherId)) recentContactIds.push(otherId);
    });

    const users = await User.find({
      _id: { $ne: currentUserId },
      isBlocked: { $ne: true },
    })
      .select(safeUserSelect)
      .sort({ role: 1, name: 1 })
      .limit(200)
      .lean();

    const recentRank = new Map(recentContactIds.map((id, index) => [id, index]));
    users.sort((a, b) => {
      const aRank = recentRank.has(toId(a._id)) ? recentRank.get(toId(a._id)) : Number.MAX_SAFE_INTEGER;
      const bRank = recentRank.has(toId(b._id)) ? recentRank.get(toId(b._id)) : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      if (a.role === "expert" && b.role !== "expert") return -1;
      if (b.role === "expert" && a.role !== "expert") return 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch chat contacts" });
  }
});

router.get("/messages/:userId/:otherId", authMiddleware, async (req, res) => {
  const { userId, otherId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ message: "Unauthorized chat access" });
  }
  if (!isValidObjectId(otherId)) {
    return res.status(400).json({ message: "Invalid recipient" });
  }

  try {
    const messages = await populateMessage(ChatMessage.find({
      $or: [
        { sender: userId, recipient: otherId },
        { sender: otherId, recipient: userId },
      ],
    }).sort({ createdAt: 1 }));

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

router.post("/messages", authMiddleware, async (req, res) => {
  try {
    const { recipient, messageType = "text" } = req.body;
    const message = String(req.body.message || "").trim();

    if (!isValidObjectId(recipient)) {
      return res.status(400).json({ message: "Valid recipient is required" });
    }
    if (recipient === req.user.id) {
      return res.status(400).json({ message: "You cannot message yourself" });
    }
    if (!["text", "image"].includes(messageType)) {
      return res.status(400).json({ message: "Invalid message type" });
    }
    if (!message) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }
    if (messageType === "image" && !message.startsWith("/uploads/") && !message.startsWith("http")) {
      return res.status(400).json({ message: "Invalid image URL" });
    }

    const recipientUser = await User.findById(recipient).select("_id isBlocked");
    if (!recipientUser || recipientUser.isBlocked) {
      return res.status(404).json({ message: "Recipient not found" });
    }

    const savedDoc = await ChatMessage.create({
      sender: req.user.id,
      recipient,
      messageType,
      message,
    });
    const saved = await populateMessage(ChatMessage.findById(savedDoc._id));

    const io = req.app.get("io");
    if (io) {
      io.to(req.user.id).to(recipient).emit("newMessage", saved);
    }
    await emitUnreadCount(req, recipient);

    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

router.post("/seen", authMiddleware, async (req, res) => {
  const messageIds = Array.isArray(req.body.messageIds) ? req.body.messageIds : [];
  try {
    const messages = await ChatMessage.find({
      _id: { $in: messageIds.filter(isValidObjectId) },
      recipient: req.user.id,
    }).select("sender");

    const idsToUpdate = messages.map((message) => message._id);
    await ChatMessage.updateMany(
      { _id: { $in: idsToUpdate } },
      { $set: { isSeen: true, seenAt: new Date() } }
    );

    const io = req.app.get("io");
    if (io && idsToUpdate.length) {
      const senderIds = [...new Set(messages.map((message) => toId(message.sender)))];
      senderIds.forEach((senderId) => io.to(senderId).emit("messagesSeen", { messageIds: idsToUpdate.map(toId) }));
    }
    await emitUnreadCount(req, req.user.id);

    res.json({ success: true, messageIds: idsToUpdate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update seen status" });
  }
});

router.get("/history/:bookingId", authMiddleware, async (req, res) => {
  const { bookingId } = req.params;
  try {
    const ChatRoom = require("../models/ChatRoom");
    const room = await ChatRoom.findOne({ booking: bookingId })
      .populate("messages.sender", "name profileImage")
      .populate("participants", "name profileImage");
    if (!room) return res.status(404).json({ message: "Chat room not found" });
    res.json({ messages: room.messages, participants: room.participants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch chat history" });
  }
});

router.post("/upload-image", authMiddleware, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No image uploaded" });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl, url: imageUrl });
});

router.get("/unread/:userId", authMiddleware, async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ message: "Unauthorized chat access" });
  }

  try {
    const unreadCount = await ChatMessage.countDocuments({ recipient: userId, isSeen: false });
    res.json({ unread: unreadCount, unreadCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch unread count" });
  }
});

module.exports = router;
