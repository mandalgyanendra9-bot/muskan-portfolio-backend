const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  expert: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true }, // gross amount earned from booking
  commission: { type: Number, required: true }, // platform fee (10%)
  netAmount: { type: Number, required: true }, // amount to transfer to expert
  status: { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending' },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Payout', payoutSchema);
