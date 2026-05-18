const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const connectDB = require("./config/db");

// LOAD ENV
dotenv.config({ path: path.join(__dirname, ".env") });

// CONNECT DB
connectDB();

const app = express();

// MIDDLEWARE
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://muskan-portfolio-frontnend.vercel.app",
  // Add any other Vercel preview URLs if needed
];
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Allow all vercel.app subdomains (for preview deployments)
    if (origin.endsWith(".vercel.app")) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// ROUTES
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/contact", require("./routes/contactRoutes"));
app.use("/api/projects", require("./routes/projectRoutes"));
app.use("/api/posts", require("./routes/postRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/bookings", require("./routes/bookingRoutes"));
app.use("/api/profiles", require("./routes/profileRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

app.get("/", (req, res) => {
  res.send("Backend Running OK");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});