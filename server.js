const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const http = require("http");
const jwt = require("jsonwebtoken");
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
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 240, keyPrefix: "api" }));

// ROUTES
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/contact", require("./routes/contactRoutes"));
app.use("/api/projects", require("./routes/projectRoutes"));
app.use("/api/posts", require("./routes/postRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/availability", require("./routes/availability"));
app.use("/api/bookings", require("./routes/bookingRoutes"));
app.use("/api/slots", require("./routes/slots"));
app.use("/api/profiles", require("./routes/profileRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/payouts", require("./routes/payoutRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/live", require("./routes/liveRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/referrals", require("./routes/referralRoutes"));

app.get("/", (req, res) => {
  res.send("Backend Running OK");
});

const server = http.createServer(app);

// Initialize Socket.io with CORS matching allowed origins
const ChatRoom = require('./models/ChatRoom');
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
const Booking = require("./models/Booking");
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

const autoCompleteExpiredBookings = async () => {
  const now = new Date();

  try {
    const expiredBookings = await Booking.find({
      status: "confirmed",
      paymentStatus: "paid",
      slotEnd: { $lte: now },
    }).populate("client expert", "name email profileImage title role");

    if (!expiredBookings.length) return;

    await Booking.updateMany(
      {
        _id: { $in: expiredBookings.map((booking) => booking._id) },
        status: "confirmed",
        paymentStatus: "paid",
        slotEnd: { $lte: now },
      },
      {
        $set: { status: "completed" },
      }
    );

    expiredBookings.forEach((booking) => {
      const updatedBooking = { ...booking.toObject(), status: "completed" };
      io.to(booking.client?._id?.toString?.() || String(booking.client)).emit("booking:completed", updatedBooking);
      io.to(booking.expert?._id?.toString?.() || String(booking.expert)).emit("booking:completed", updatedBooking);
      if (booking.meetingLink) {
        const roomId = booking.meetingLink.split("/").filter(Boolean).pop();
        if (roomId) {
          io.to(roomId).emit("booking:autoCompleted", updatedBooking);
        }
      }
    });
  } catch (error) {
    console.error("Auto-complete bookings error:", error.message);
  }
};

setInterval(() => {
  autoCompleteExpiredBookings();
}, 60 * 1000);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 New socket connection:', socket.id);
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const cleanToken = token.startsWith("Bearer ") ? token.slice(7) : token;
      const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET || "secretkey");
      socket.userId = decoded.id;
    } catch (error) {
      console.error("Socket auth error:", error.message);
    }
  }

// Join a chat room based on booking ID and user ID (after auth)
  socket.on('joinRoom', async ({ bookingId, userId }) => {
    try {
      if (socket.userId && userId && socket.userId !== userId) {
        socket.emit('error', 'Unauthorized to join this chat');
        return;
      }
      const room = await ChatRoom.findOne({ booking: bookingId });
      if (!room) {
        socket.emit('error', 'Chat room not found');
        return;
      }
      const participantIds = room.participants.map(p => p.toString());
      if (!participantIds.includes(userId)) {
        socket.emit('error', 'Unauthorized to join this chat');
        return;
      }
      const roomName = `chat_${bookingId}`;
      socket.join(roomName);
      socket.bookingId = bookingId;
      socket.userId = socket.userId || userId;
      console.log(`User ${userId} joined chat room ${roomName}`);
    } catch (err) {
      console.error('joinRoom error:', err);
    }
  });
  socket.on('join', (userId) => {
    const roomId = socket.userId || userId;
    if (!roomId || (socket.userId && userId && socket.userId !== userId)) return;
    socket.join(roomId);
    console.log(`User ${roomId} joined room`);
  });

// Receive a chat message for a booking and broadcast to the room
  socket.on('sendMessage', async ({ bookingId, content, messageType = 'text' }) => {
    try {
      const room = await ChatRoom.findOne({ booking: bookingId });
      if (!room) {
        socket.emit('error', 'Chat room not found');
        return;
      }
      const msg = {
        sender: socket.userId,
        type: messageType,
        content,
        createdAt: new Date()
      };
      room.messages.push(msg);
      await room.save();
      const roomName = `chat_${bookingId}`;
      io.to(roomName).emit('newMessage', { ...msg, bookingId });
    } catch (err) {
      console.error('sendMessage error:', err);
    }
  });
  socket.on('chatMessage', async (msg) => {
    // msg: { sender, recipient, message, messageType }
    try {
      if (!socket.userId || socket.userId !== msg.sender) return;
      const ChatMessage = require('./models/ChatMessage');
      const savedDoc = await ChatMessage.create({
        sender: socket.userId,
        recipient: msg.recipient,
        message: String(msg.message || "").trim(),
        messageType: msg.messageType === "image" ? "image" : "text",
      });
      const saved = await ChatMessage.findById(savedDoc._id)
        .populate("sender", "name email profileImage title role")
        .populate("recipient", "name email profileImage title role");
      // Emit to both participants' rooms
      io.to(socket.userId).to(msg.recipient).emit('newMessage', saved);
    } catch (err) {
      console.error('Chat message error:', err);
    }
  });

  // Typing indicator
  socket.on('typing', ({ sender, recipient }) => {
    if (socket.userId && sender && socket.userId !== sender) return;
    io.to(recipient).emit('typing', { sender });
  });

  // Seen status (single message ID or array)
  socket.on('seen', async ({ messageIds }) => {
    try {
      const ChatMessage = require('./models/ChatMessage');
      const messages = await ChatMessage.find({
        _id: { $in: messageIds || [] },
        ...(socket.userId ? { recipient: socket.userId } : {}),
      }).select("sender");
      const idsToUpdate = messages.map((message) => message._id);
      await ChatMessage.updateMany({ _id: { $in: idsToUpdate } }, { $set: { isSeen: true, seenAt: new Date() } });
      const senderIds = [...new Set(messages.map((message) => message.sender.toString()))];
      senderIds.forEach((senderId) => io.to(senderId).emit('messagesSeen', { messageIds: idsToUpdate.map((id) => id.toString()) }));
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
