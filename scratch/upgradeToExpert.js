const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    // Find a client user to promote
    const user = await User.findOne({ role: { $ne: 'expert' } }).select('_id name email');
    if (!user) {
      console.log('No non‑expert user found to promote');
      await mongoose.disconnect();
      return;
    }
    user.role = 'expert';
    user.verifiedExpert = true;
    user.isApproved = true;
    await user.save();
    console.log('Promoted user to expert');
    console.log('Expert ID:', user._id.toString());
    console.log('Name:', user.name);
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
})();
