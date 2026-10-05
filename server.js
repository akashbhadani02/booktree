require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();

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

const User = mongoose.model("User", userSchema);

function makeReferralCode(name) {
  const base = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5).toUpperCase() || "USER";
  return base + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function sign(user) {
  return jwt.sign({ id: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return res.status(401).json({ message: "Login required" });
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: "User not found" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired login" });
  }
}

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const cleanEmail = email.toLowerCase().trim();
    if (await User.findOne({ email: cleanEmail })) return res.status(409).json({ message: "Email already registered" });

    let parent = null;
    if (referralCode) {
      parent = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (!parent) return res.status(400).json({ message: "Referral code not found" });
      if (parent.directCount >= 3) return res.status(400).json({ message: "This member already has 3 direct members" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let code;
    do { code = makeReferralCode(name); } while (await User.exists({ referralCode: code }));

    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      referralCode: code,
      parent: parent ? parent._id : null,
      isAdmin: cleanEmail === ADMIN_EMAIL
    });

    if (parent) {
      await User.findByIdAndUpdate(parent._id, { $inc: { directCount: 1 } });
    }

    res.json({
      token: sign(user),
      user: { id: user._id, name: user.name, email: user.email, referralCode: user.referralCode }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || "").toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash)))
    return res.status(401).json({ message: "Invalid email or password" });

  res.json({
    token: sign(user),
    user: { id: user._id, name: user.name, email: user.email, referralCode: user.referralCode }
  });
});

app.get("/api/me", auth, async (req, res) => {
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    referralCode: req.user.referralCode,
    directCount: req.user.directCount,
    referralLink: `${req.protocol}://${req.get("host")}/?ref=${req.user.referralCode}`
  });
});

app.get("/api/direct", auth, async (req, res) => {
  const users = await User.find({ parent: req.user._id })
    .select("name email referralCode directCount createdAt")
    .sort({ createdAt: 1 });
  res.json(users);
});

app.get("/api/tree", auth, async (req, res) => {
  const users = await User.find({})
    .select("name referralCode parent directCount createdAt")
    .lean();

  const map = new Map();
  users.forEach(u => map.set(String(u._id), { ...u, children: [] }));

  users.forEach(u => {
    if (u.parent && map.has(String(u.parent))) {
      map.get(String(u.parent)).children.push(map.get(String(u._id)));
    }
  });

  const root = map.get(String(req.user._id));
  res.json(root || null);
});

app.get("/api/admin/users", auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: "Admin only" });
  const users = await User.find({})
    .select("name email referralCode parent directCount isAdmin createdAt")
    .populate("parent", "name referralCode")
    .sort({ createdAt: -1 });
  res.json(users);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
