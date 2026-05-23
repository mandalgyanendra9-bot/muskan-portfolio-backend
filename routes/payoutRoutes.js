const express = require('express');
const router = express.Router();
const Payout = require('../models/Payout');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Middleware stack for admin routes
const adminOnly = [authMiddleware, adminMiddleware];

/**
 * GET /api/payouts/pending
 * Returns list of pending payouts for admin review
 */
router.get('/pending', adminOnly, async (req, res) => {
  try {
    const pending = await Payout.find({ status: 'pending' })
      .populate('expert', 'name email upiId bankDetails')
      .sort({ createdAt: -1 });
    res.json(pending);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * PUT /api/payouts/:id/approve
 * Admin approves a payout, marks as paid, deducts commission, and records transaction ID.
 * Expected body: { transactionId: String }
 */
router.put('/:id/approve', adminOnly, async (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) {
    return res.status(400).json({ message: 'Transaction ID is required' });
  }
  try {
    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ message: 'Payout not found' });
    if (payout.status !== 'pending') {
      return res.status(400).json({ message: 'Payout is not pending' });
    }
    // Update payout record
    payout.status = 'paid';
    payout.transactionId = transactionId;
    payout.paidAt = new Date();
    await payout.save();

    // Update expert's pending payout amount
    const expert = await User.findById(payout.expert);
    if (expert) {
      // Reduce pending payout amount
      expert.pendingPayoutAmount = Math.max(0, (expert.pendingPayoutAmount || 0) - payout.amount);
      await expert.save();
    }
    res.json({ message: 'Payout approved and marked as paid', payout });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
