const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Disable command buffering so queries fail immediately if MongoDB is not connected
    mongoose.set("bufferCommands", false);

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
    });
    console.log("MongoDB Connected");
  } catch (error) {
    console.log("DB Error:", error.message);
  }
};

module.exports = connectDB;