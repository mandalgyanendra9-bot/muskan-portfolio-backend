const express = require("express");
const router = express.Router();
const Review = require("../models/Review");
const Booking = require("../models/Booking");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

// SUBMIT A REVIEW (Client only)
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { bookingId, rating, reviewText } = req.body;
    
    // Find booking
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    
    // Verify client
    if (booking.client.toString() !== req.user.id) {
      return res.status(403).json({ message: "You are not authorized to review this booking" });
    }
    
    // Check if already reviewed
    if (booking.ratingGiven) {
      return res.status(400).json({ message: "You have already reviewed this session" });
    }
    
    // Create review
    const review = await Review.create({
      client: req.user.id,
      expert: booking.expert,
      booking: bookingId,
      rating: Number(rating),
      reviewText
    });
    
    // Update booking
    booking.ratingGiven = true;
    await booking.save();
    
    // Recalculate average rating for expert
    const expertId = booking.expert;
    const allReviews = await Review.find({ expert: expertId });
    const count = allReviews.length;
    const sum = allReviews.reduce((acc, r) => acc + r.rating, 0);
    const avgRating = count > 0 ? (sum / count).toFixed(1) : 5;
    
    await User.findByIdAndUpdate(expertId, {
      rating: Number(avgRating),
      reviewsCount: count
    });
    
    res.status(201).json({ message: "Review submitted successfully", review });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET REVIEWS FOR AN EXPERT (public)
router.get("/expert/:expertId", async (req, res) => {
  try {
    const reviews = await Review.find({ expert: req.params.expertId })
      .populate("client", "name profileImage")
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET MY REVIEWS (logged-in expert sees reviews about themselves)
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find({ expert: req.user.id })
      .populate("client", "name profileImage")
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
