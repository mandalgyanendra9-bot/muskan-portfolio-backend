const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
// Load MONGO_URI from backend/.env
const envPath = path.join(__dirname, '..', '.env');
let mongoUri = '';
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*MONGO_URI\s*=\s*(.+)\s*$/);
    if (m) { mongoUri = m[1].trim(); break; }
  }
}
if (!mongoUri) { console.error('MONGO_URI not found'); process.exit(1); }

const User = require('../models/User');
(async () => {
  try {
    await mongoose.connect(mongoUri);
    // Try to find an expert by role first, then by verifiedExpert flag
    let expert = await User.findOne({ role: 'expert' }).select('_id name');
    if (!expert) {
      // Fallback: any user marked as a verified expert
      expert = await User.findOne({ verifiedExpert: true }).select('_id name');
    }
    if (!expert) {
      console.log('No expert found in the database');
    } else {
      console.log('Expert ID:', expert._id.toString());
      console.log('Name:', expert.name);
    }
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
