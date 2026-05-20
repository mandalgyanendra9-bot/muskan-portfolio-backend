const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messageType: { type: String, enum: ['text', 'image'], default: 'text' },
  message: { type: String, required: true }, // text or image URL
  isSeen: { type: Boolean, default: false },
  seenAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
