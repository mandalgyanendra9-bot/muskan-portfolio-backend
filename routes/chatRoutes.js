const express = require('express');
const router = express.Router();
const ChatMessage = require('../models/ChatMessage');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/Upload'); // reuse multer config for image uploads

// Get chat messages between two users (sorted by time)
router.get('/messages/:userId/:otherId', authMiddleware, async (req, res) => {
  const { userId, otherId } = req.params;
  try {
    const messages = await ChatMessage.find({
      $or: [
        { sender: userId, recipient: otherId },
        { sender: otherId, recipient: userId },
      ],
    })
      .populate('sender', 'name profileImage')
      .populate('recipient', 'name profileImage')
      .sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// Mark messages as seen
router.post('/seen', authMiddleware, async (req, res) => {
  const { messageIds } = req.body; // array of message _id
  try {
    await ChatMessage.updateMany(
      { _id: { $in: messageIds } },
      { $set: { isSeen: true, seenAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update seen status' });
  }
});

// Get chat history for a booking (requires participants)
router.get('/history/:bookingId', authMiddleware, async (req, res) => {
  const { bookingId } = req.params;
  try {
    const ChatRoom = require('../models/ChatRoom');
    const room = await ChatRoom.findOne({ booking: bookingId })
      .populate('messages.sender', 'name profileImage')
      .populate('participants', 'name profileImage');
    if (!room) return res.status(404).json({ message: 'Chat room not found' });
    res.json({ messages: room.messages, participants: room.participants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch chat history' });
  }
});

router.post('/upload-image', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

// Unread messages count for a user
router.get('/unread/:userId', authMiddleware, async (req, res) => {
  const { userId } = req.params;
  try {
    const unreadCount = await ChatMessage.countDocuments({ recipient: userId, isSeen: false });
    res.json({ unreadCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
});

module.exports = router;
