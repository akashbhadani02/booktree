require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

if (!JWT_SECRET) console.warn("JWT_SECRET is not configured.");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  referralCode: { type: String, required: true, unique: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  directCount: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model("User", userSchema);

let cachedConnection = null;
async function connectDB() {
  if (cachedConnection && mongoose.connection.readyState === 1) return cachedConnection;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10
  });
  return cachedConnection;
}

function makeReferralCode(name) {
  const base = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5).toUpperCase() || "USER";
  return base + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function sign(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Login required" });
    }
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired login" });
  }
}

app.get("/api/health", async (req, res) => {
  try {
    await connectDB();
    res.json({ ok: true, database: "connected" });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Database connection failed" });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    await connectDB();

    const { name, email, password, referralCode } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    if (await User.findOne({ email: cleanEmail })) {
      return res.status(409).json({ message: "Email already registered" });
    }

    let parent = null;
    if (referralCode && String(referralCode).trim()) {
      parent = await User.findOne({
        referralCode: String(referralCode).trim().toUpperCase()
      });
      if (!parent) return res.status(400).json({ message: "Referral code not found" });
      if (parent.directCount >= 3) {
        return res.status(400).json({ message: "This member already has 3 direct members" });
      }
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    let code;
    do {
      code = makeReferralCode(String(name));
    } while (await User.exists({ referralCode: code }));

    const user = await User.create({
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash,
      referralCode: code,
      parent: parent ? parent._id : null,
      isAdmin: !!ADMIN_EMAIL && cleanEmail === ADMIN_EMAIL
    });

    if (parent) {
      await User.findByIdAndUpdate(parent._id, { $inc: { directCount: 1 } });
    }

    res.json({
      token: sign(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        referralCode: user.referralCode
      }
    });
  } catch (e) {
    console.error(e);
    if (e && e.code === 11000) {
      return res.status(409).json({ message: "Email or referral code already exists. Please try again." });
    }
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    await connectDB();
    const { email, password } = req.body || {};
    const user = await User.findOne({
      email: String(email || "").toLowerCase().trim()
    });

    if (!user || !(await bcrypt.compare(String(password || ""), user.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    res.json({
      token: sign(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        referralCode: user.referralCode
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Login failed" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    await connectDB();
    res.json({
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      referralCode: req.user.referralCode,
      directCount: req.user.directCount,
      referralLink: `${req.protocol}://${req.get("host")}/?ref=${req.user.referralCode}`
    });
  } catch {
    res.status(500).json({ message: "Unable to load profile" });
  }
});

app.get("/api/direct", auth, async (req, res) => {
  try {
    await connectDB();
    const users = await User.find({ parent: req.user._id })
      .select("name email referralCode directCount createdAt")
      .sort({ createdAt: 1 })
      .lean();
    res.json(users);
  } catch {
    res.status(500).json({ message: "Unable to load members" });
  }
});

app.get("/api/tree", auth, async (req, res) => {
  try {
    await connectDB();
    const users = await User.find({})
      .select("name referralCode parent directCount createdAt")
      .lean();

    const map = new Map();
    for (const u of users) {
      map.set(String(u._id), { ...u, children: [] });
    }

    for (const u of users) {
      if (u.parent && map.has(String(u.parent))) {
        map.get(String(u.parent)).children.push(map.get(String(u._id)));
      }
    }

    res.json(map.get(String(req.user._id)) || null);
  } catch {
    res.status(500).json({ message: "Unable to load tree" });
  }
});

app.get("/api/admin/users", auth, async (req, res) => {
  try {
    await connectDB();
    if (!req.user.isAdmin) return res.status(403).json({ message: "Admin only" });

    const users = await User.find({})
      .select("name email referralCode parent directCount isAdmin createdAt")
      .populate("parent", "name referralCode")
      .sort({ createdAt: -1 })
      .lean();

    res.json(users);
  } catch {
    res.status(500).json({ message: "Unable to load users" });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

module.exports = app;
