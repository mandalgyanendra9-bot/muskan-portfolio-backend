const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const rateLimit = require("./middleware/rateLimiter");

// LOAD ENV
dotenv.config({ path: path.join(__dirname, ".env") });

// CONNECT DB
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// MIDDLEWARE
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://muskan-portfolio-frontend.vercel.app",
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
};

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Fix COOP for Google OAuth
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});

app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 240, keyPrefix: "api" }));

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
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/payouts", require("./routes/payoutRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/live", require("./routes/liveRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));

app.get("/", (req, res) => {
  res.send("Backend Running OK");
});

const server = http.createServer(app);

// Initialize Socket.io with CORS matching allowed origins
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
});

app.set("io", io);

const LiveStream = require("./models/LiveStream");
const liveViewers = new Map();

const emitLiveViewerCount = async (roomId) => {
  const viewerCount = liveViewers.get(roomId)?.size || 0;
  io.to(roomId).emit("live:viewers", { roomId, viewerCount });

  try {
    const stream = await LiveStream.findOne({ roomId, status: "live" });
    if (stream) {
      stream.viewerCount = viewerCount;
      stream.peakViewers = Math.max(stream.peakViewers || 0, viewerCount);
      await stream.save();
    }
  } catch (error) {
    console.error("Live viewer count update error:", error.message);
  }
};

const removeSocketFromLiveRooms = async (socket) => {
  const updates = [];
  liveViewers.forEach((viewers, roomId) => {
    if (viewers.delete(socket.id)) {
      if (viewers.size === 0) liveViewers.delete(roomId);
      updates.push(emitLiveViewerCount(roomId));
    }
  });
  await Promise.all(updates);
};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 New socket connection:', socket.id);

  // Join a private room based on user ID (sent from client after auth)
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  // Receive a chat message and broadcast to the recipient's room
  socket.on('chatMessage', async (msg) => {
    // msg: { sender, recipient, message, messageType }
    try {
      const ChatMessage = require('./models/ChatMessage');
      const saved = await ChatMessage.create(msg);
      // Emit to both participants' rooms
      io.to(msg.sender).to(msg.recipient).emit('newMessage', saved);
    } catch (err) {
      console.error('Chat message error:', err);
    }
  });

  // Typing indicator
  socket.on('typing', ({ sender, recipient }) => {
    io.to(recipient).emit('typing', { sender });
  });

  // Seen status (single message ID or array)
  socket.on('seen', async ({ messageIds }) => {
    try {
      const ChatMessage = require('./models/ChatMessage');
      await ChatMessage.updateMany({ _id: { $in: messageIds } }, { $set: { isSeen: true, seenAt: new Date() } });
      io.to(sender).emit('messagesSeen', { messageIds });
    } catch (err) {
      console.error('Seen update error:', err);
    }
  });

  socket.on("live:join", async ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    if (!liveViewers.has(roomId)) liveViewers.set(roomId, new Set());
    liveViewers.get(roomId).add(socket.id);
    await emitLiveViewerCount(roomId);
  });

  socket.on("live:leave", async ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    const viewers = liveViewers.get(roomId);
    if (viewers) {
      viewers.delete(socket.id);
      if (viewers.size === 0) liveViewers.delete(roomId);
    }
    await emitLiveViewerCount(roomId);
  });

  socket.on('disconnect', async () => {
    await removeSocketFromLiveRooms(socket);
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

// Duplicate socket event handlers removed – keep the earlier definitions above

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
