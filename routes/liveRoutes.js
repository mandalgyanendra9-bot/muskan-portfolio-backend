const express = require("express");
const router = express.Router();
const LiveStream = require("../models/LiveStream");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { isAdminEmail } = require("../utils/adminAccess");

const safeUserSelect = "name email profileImage title role coinBalance walletBalance subscriptionPlan";

const GIFT_CATALOG = [
  { id: "rose", name: "Rose", coins: 10 },
  { id: "spark", name: "Spark", coins: 25 },
  { id: "star", name: "Star", coins: 50 },
  { id: "crown", name: "Crown", coins: 100 },
];

const getGift = (giftId) => GIFT_CATALOG.find((gift) => gift.id === giftId);

const populateStream = (query) =>
  query.populate("host", "name profileImage title role rating followers subscribers subscriptionPlan");

router.get("/gifts/catalog", (req, res) => {
  res.json(GIFT_CATALOG);
});

router.get("/active", async (req, res) => {
  try {
    const streams = await populateStream(
      LiveStream.find({ status: "live" }).sort({ startedAt: -1 })
    );
    res.json(streams);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/coins/claim", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();
    const lastClaim = user.lastCoinClaimAt ? new Date(user.lastCoinClaimAt) : null;
    const canClaim = !lastClaim || now.getTime() - lastClaim.getTime() >= 24 * 60 * 60 * 1000;

    if (!canClaim) {
      return res.status(429).json({ message: "Daily bonus already claimed. Try again tomorrow." });
    }

    user.coinBalance = (user.coinBalance || 0) + 100;
    user.lastCoinClaimAt = now;
    await user.save();

    const updatedUser = await User.findById(user._id).select(safeUserSelect);
    res.json({ message: "100 live coins added", user: updatedUser });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/start", authMiddleware, async (req, res) => {
  try {
    const { title, category } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Live title is required" });
    }

    await LiveStream.updateMany(
      { host: req.user.id, status: "live" },
      { status: "ended", endedAt: new Date(), viewerCount: 0 }
    );

    const stream = await LiveStream.create({
      host: req.user.id,
      title: title.trim(),
      category: category?.trim() || "Portfolio Live",
      roomId: `live_${req.user.id}_${Date.now().toString(36)}`,
    });

    const populated = await populateStream(LiveStream.findById(stream._id));
    req.app.get("io")?.emit("live:started", populated);
    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const stream = await populateStream(LiveStream.findById(req.params.id));
    if (!stream) return res.status(404).json({ message: "Live stream not found" });
    res.json(stream);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/:id/end", authMiddleware, async (req, res) => {
  try {
    const stream = await LiveStream.findById(req.params.id);
    if (!stream) return res.status(404).json({ message: "Live stream not found" });

    const user = await User.findById(req.user.id).select("email role");
    const isHost = stream.host.toString() === req.user.id;
    const isAdmin = user?.role === "admin" && isAdminEmail(user.email);
    if (!isHost && !isAdmin) {
      return res.status(403).json({ message: "Only the host can end this live stream" });
    }

    stream.status = "ended";
    stream.endedAt = new Date();
    stream.viewerCount = 0;
    await stream.save();

    const populated = await populateStream(LiveStream.findById(stream._id));
    req.app.get("io")?.to(stream.roomId).emit("live:ended", populated);
    req.app.get("io")?.emit("live:ended:list", populated);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/:id/chat", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const stream = await LiveStream.findById(req.params.id);
    if (!stream || stream.status !== "live") {
      return res.status(404).json({ message: "Live stream is not active" });
    }

    const user = await User.findById(req.user.id).select("name");
    const chatMessage = {
      user: req.user.id,
      name: user?.name || "Viewer",
      message: message.trim().slice(0, 300),
      createdAt: new Date(),
    };

    stream.chatMessages.push(chatMessage);
    if (stream.chatMessages.length > 100) stream.chatMessages = stream.chatMessages.slice(-100);
    await stream.save();

    const savedMessage = stream.chatMessages[stream.chatMessages.length - 1];
    req.app.get("io")?.to(stream.roomId).emit("live:chat", savedMessage);
    res.status(201).json(savedMessage);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/:id/gift", authMiddleware, async (req, res) => {
  try {
    const gift = getGift(req.body.giftId);
    if (!gift) return res.status(400).json({ message: "Invalid gift selected" });

    const stream = await LiveStream.findById(req.params.id);
    if (!stream || stream.status !== "live") {
      return res.status(404).json({ message: "Live stream is not active" });
    }

    if (stream.host.toString() === req.user.id) {
      return res.status(400).json({ message: "You cannot send gifts to your own live stream" });
    }

    const sender = await User.findById(req.user.id);
    if (!sender) return res.status(404).json({ message: "User not found" });
    if (sender.coinBalance === undefined || sender.coinBalance === null) sender.coinBalance = 250;
    if (sender.coinBalance < gift.coins) {
      return res.status(400).json({ message: "Not enough coins" });
    }

    sender.coinBalance -= gift.coins;
    await sender.save();

    await User.findByIdAndUpdate(stream.host, { $inc: { coinBalance: gift.coins } });

    const giftEvent = {
      user: sender._id,
      name: sender.name,
      giftId: gift.id,
      giftName: gift.name,
      coins: gift.coins,
      createdAt: new Date(),
    };

    stream.gifts.push(giftEvent);
    if (stream.gifts.length > 100) stream.gifts = stream.gifts.slice(-100);
    stream.totalCoins += gift.coins;
    await stream.save();

    const savedGift = stream.gifts[stream.gifts.length - 1];
    req.app.get("io")?.to(stream.roomId).emit("live:gift", savedGift);
    const updatedUser = await User.findById(sender._id).select(safeUserSelect);

    res.status(201).json({
      gift: savedGift,
      user: updatedUser,
      totalCoins: stream.totalCoins,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
