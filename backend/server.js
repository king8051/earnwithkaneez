// ─── EARN WITH KANEEZ – Halal Trading – Full Backend (MongoDB) ────────────
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { MongoClient, ObjectId } = require("mongodb");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_me";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Anshu123";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Anshu@2026";
const MONGODB_URI = process.env.MONGODB_URI;

// ─── DIRECTORIES ──────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

// ─── MULTER (QR upload) ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, "qr-" + Date.now() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [".jpg", ".jpeg", ".png"].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Only JPG, JPEG, PNG allowed"), ok);
  },
});

// ─── MONGODB CONNECTION ───────────────────────────────────────────────────
let db;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db("invest_anshu");
  console.log("✅ Connected to MongoDB Atlas");

  // Create indexes for fast lookups
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ mobile: 1 }, { unique: true });
  await db.collection("investments").createIndex({ userId: 1 });
  await db.collection("deposits").createIndex({ userId: 1 });
  await db.collection("withdrawals").createIndex({ userId: 1 });

  await seedDefaultData();
}

// ─── SEED DEFAULT DATA ────────────────────────────────────────────────────
async function seedDefaultData() {
  const planCount = await db.collection("plans").countDocuments();
  if (planCount === 0) {
    await db.collection("plans").insertMany([
      { name: "Starter BTC", asset: "BTC", minInvest: 500, maxInvest: 5000, returnPct: 12, durationMins: 60, color: "#F7931A", active: true, createdAt: new Date() },
      { name: "USDT Pro", asset: "USDT", minInvest: 1000, maxInvest: 25000, returnPct: 18, durationMins: 1440, color: "#26A17B", active: true, createdAt: new Date() },
      { name: "Gold Premium", asset: "GOLD", minInvest: 2000, maxInvest: 100000, returnPct: 25, durationMins: 4320, color: "#D4AF37", active: true, createdAt: new Date() },
      { name: "Forex Elite", asset: "FOREX", minInvest: 5000, maxInvest: 500000, returnPct: 35, durationMins: 10080, color: "#A855F7", active: true, createdAt: new Date() },
    ]);
    console.log("✅ Default plans seeded");
  }

  const settingsCount = await db.collection("settings").countDocuments({ key: "site" });
  if (settingsCount === 0) {
    await db.collection("settings").insertOne({
      key: "site",
      paymentInfo: {
        accountName: "Anshu Kumar",
        accountNumber: "1234567890",
        ifsc: "SBIN0001234",
        bankName: "State Bank of India",
        upiId: "anshu@upi",
        qrImage: "",
      },
      contact: {
        email: "support@investwithanshu.com",
        mobile: "+91 9876543210",
        address: "Mumbai, India",
        weekdayLabel: "Mon–Sat",
        weekdayHours: "9:00 AM – 8:00 PM",
        sundayHours: "10:00 AM – 4:00 PM",
        supportNote: "We respond within 1–4 hours.",
      },
    });
    console.log("✅ Default settings seeded");
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

// Convert MongoDB _id (ObjectId) to string for API responses
function cleanUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return { ...rest, _id: user._id.toString() };
}

function toObjectId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

function authUser(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    if (decoded.role !== "user") return res.status(403).json({ error: "Forbidden" });
    req.userId = decoded.id;
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

function authAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

// ─── AUTO-COMPLETE INVESTMENTS (runs every 30s) ───────────────────────────
async function completeMaturedInvestments() {
  if (!db) return;
  const now = new Date();
  const matured = await db.collection("investments").find({ status: "running", maturesAt: { $lte: now } }).toArray();
  for (const inv of matured) {
    const total = inv.amount + inv.profit;
    await db.collection("users").updateOne({ _id: new ObjectId(inv.userId) }, { $inc: { wallet: total } });
    await db.collection("investments").updateOne({ _id: inv._id }, { $set: { status: "completed", completedAt: now } });
    console.log(`💰 Investment ${inv._id} completed → credited ₹${total} to user ${inv.userId}`);
  }
}
setInterval(completeMaturedInvestments, 30000);

// ═══════════════════════════════════════════════════════════════════════
// 🔓 PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════
app.get("/api/plans", async (req, res) => {
  const plans = await db.collection("plans").find({ active: true }).toArray();
  res.json(plans.map(p => ({ ...p, _id: p._id.toString() })));
});

app.get("/api/settings/public", async (req, res) => {
  const s = await db.collection("settings").findOne({ key: "site" });
  res.json({ paymentInfo: s?.paymentInfo || {}, contact: s?.contact || {} });
});

// ═══════════════════════════════════════════════════════════════════════
// 🔐 AUTH
// ═══════════════════════════════════════════════════════════════════════
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, email, mobile, password } = req.body;
    if (!name || !username || !email || !mobile || !password)
      return res.status(400).json({ error: "All fields required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const u = username.toLowerCase().trim();

    if (await db.collection("users").findOne({ username: u }))
      return res.status(400).json({ error: "Username already taken" });
    if (await db.collection("users").findOne({ email: email.toLowerCase() }))
      return res.status(400).json({ error: "Email already registered" });
    if (await db.collection("users").findOne({ mobile }))
      return res.status(400).json({ error: "Mobile already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.collection("users").insertOne({
      name, username: u, email: email.toLowerCase(), mobile,
      passwordHash, wallet: 0, bankDetails: {}, createdAt: new Date(),
    });

    const user = await db.collection("users").findOne({ _id: result.insertedId });
    const token = signToken({ id: user._id.toString(), role: "user" });
    res.json({ token, user: cleanUser(user) });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: "Username, email or mobile already exists" });
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.collection("users").findOne({ username: username.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: "Invalid username or password" });
    if (!await bcrypt.compare(password, user.passwordHash))
      return res.status(401).json({ error: "Invalid username or password" });
    const token = signToken({ id: user._id.toString(), role: "user" });
    res.json({ token, user: cleanUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auth/admin-login", async (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({ token: signToken({ id: "admin", role: "admin" }) });
  }
  res.status(401).json({ error: "Invalid admin credentials" });
});

// ═══════════════════════════════════════════════════════════════════════
// 👤 USER ROUTES
// ═══════════════════════════════════════════════════════════════════════
app.get("/api/user/me", authUser, async (req, res) => {
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.userId) });
  if (!user) return res.status(404).json({ error: "User not found" });

  const investments = await db.collection("investments").find({ userId: req.userId }).sort({ createdAt: -1 }).toArray();
  const deposits = await db.collection("deposits").find({ userId: req.userId }).sort({ createdAt: -1 }).toArray();
  const withdrawals = await db.collection("withdrawals").find({ userId: req.userId }).sort({ createdAt: -1 }).toArray();

  res.json({
    ...cleanUser(user),
    investments: investments.map(i => ({ ...i, _id: i._id.toString() })),
    deposits: deposits.map(d => ({ ...d, _id: d._id.toString() })),
    withdrawals: withdrawals.map(w => ({ ...w, _id: w._id.toString() })),
  });
});

app.put("/api/user/bank", authUser, async (req, res) => {
  await db.collection("users").updateOne({ _id: new ObjectId(req.userId) }, { $set: { bankDetails: req.body } });
  res.json({ ok: true });
});

app.put("/api/user/password", authUser, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.userId) });
  if (!await bcrypt.compare(oldPassword, user.passwordHash))
    return res.status(400).json({ error: "Current password is incorrect" });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.collection("users").updateOne({ _id: new ObjectId(req.userId) }, { $set: { passwordHash } });
  res.json({ ok: true });
});

app.post("/api/deposits", authUser, async (req, res) => {
  const { amount, txnId } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: "Minimum ₹100" });
  if (!txnId) return res.status(400).json({ error: "Transaction ID required" });
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.userId) });
  const result = await db.collection("deposits").insertOne({
    userId: req.userId, userName: user.name, userUsername: user.username,
    amount, txnId, status: "pending", createdAt: new Date(),
  });
  const dep = await db.collection("deposits").findOne({ _id: result.insertedId });
  res.json({ ...dep, _id: dep._id.toString() });
});

app.post("/api/investments", authUser, async (req, res) => {
  const { planId, amount } = req.body;
  const plan = await db.collection("plans").findOne({ _id: new ObjectId(planId), active: true });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (amount < plan.minInvest || amount > plan.maxInvest)
    return res.status(400).json({ error: `Amount must be ₹${plan.minInvest}–₹${plan.maxInvest}` });
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.userId) });
  if (user.wallet < amount) return res.status(400).json({ error: "Insufficient wallet balance" });
  await db.collection("users").updateOne({ _id: new ObjectId(req.userId) }, { $inc: { wallet: -amount } });
  const profit = Math.round(amount * plan.returnPct / 100);
  const maturesAt = new Date(Date.now() + plan.durationMins * 60 * 1000);
  const durLabel = plan.durationMins >= 60 ? `${plan.durationMins / 60}h` : `${plan.durationMins}m`;
  const result = await db.collection("investments").insertOne({
    userId: req.userId, userName: user.name, userUsername: user.username,
    planId: planId.toString(), planName: plan.name, asset: plan.asset, amount, profit,
    duration: durLabel, status: "running", createdAt: new Date(), maturesAt,
  });
  const inv = await db.collection("investments").findOne({ _id: result.insertedId });
  res.json({ ...inv, _id: inv._id.toString() });
});

app.post("/api/withdrawals", authUser, async (req, res) => {
  const { amount, method, accountDetails } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: "Minimum ₹100" });
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.userId) });
  if (user.wallet < amount) return res.status(400).json({ error: "Insufficient balance" });
  await db.collection("users").updateOne({ _id: new ObjectId(req.userId) }, { $inc: { wallet: -amount } });
  const result = await db.collection("withdrawals").insertOne({
    userId: req.userId, userName: user.name, userUsername: user.username,
    amount, method, accountDetails, status: "pending", createdAt: new Date(),
  });
  const wd = await db.collection("withdrawals").findOne({ _id: result.insertedId });
  res.json({ ...wd, _id: wd._id.toString() });
});

// ═══════════════════════════════════════════════════════════════════════
// 🛡️ ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════
app.get("/api/admin/overview", authAdmin, async (req, res) => {
  const users = await db.collection("users").countDocuments();
  const pendingDeposits = await db.collection("deposits").countDocuments({ status: "pending" });
  const pendingWithdrawals = await db.collection("withdrawals").countDocuments({ status: "pending" });
  const approvedDeposits = await db.collection("deposits").find({ status: "approved" }).toArray();
  const approvedWithdrawals = await db.collection("withdrawals").find({ status: "approved" }).toArray();
  const allInv = await db.collection("investments").find({}).toArray();
  res.json({
    users, pendingDeposits, pendingWithdrawals,
    totalDeposited: approvedDeposits.reduce((s, d) => s + d.amount, 0),
    totalWithdrawn: approvedWithdrawals.reduce((s, w) => s + w.amount, 0),
    totalInvested: allInv.reduce((s, i) => s + i.amount, 0),
  });
});

app.get("/api/admin/users", authAdmin, async (req, res) => {
  const users = await db.collection("users").find({}).sort({ createdAt: -1 }).toArray();
  res.json(users.map(cleanUser));
});

app.put("/api/admin/users/:id/wallet", authAdmin, async (req, res) => {
  await db.collection("users").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { wallet: Number(req.body.wallet) } }
  );
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", authAdmin, async (req, res) => {
  const uid = req.params.id;
  await db.collection("users").deleteOne({ _id: new ObjectId(uid) });
  await db.collection("investments").deleteMany({ userId: uid });
  await db.collection("deposits").deleteMany({ userId: uid });
  await db.collection("withdrawals").deleteMany({ userId: uid });
  res.json({ ok: true });
});

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────
app.get("/api/admin/users/export", authAdmin, async (req, res) => {
  const users = await db.collection("users").find({}).toArray();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Earn with Kaneez";
  wb.created = new Date();
  const ws = wb.addWorksheet("Customers");
  ws.columns = [
    { header: "Name", key: "name", width: 22 },
    { header: "Username", key: "username", width: 18 },
    { header: "Email", key: "email", width: 28 },
    { header: "Mobile", key: "mobile", width: 16 },
    { header: "Wallet (₹)", key: "wallet", width: 14 },
    { header: "Bank Account Holder", key: "accountHolder", width: 22 },
    { header: "Bank Account No.", key: "accountNumber", width: 20 },
    { header: "IFSC", key: "ifsc", width: 15 },
    { header: "Bank Name", key: "bankName", width: 22 },
    { header: "UPI ID", key: "upiId", width: 22 },
    { header: "Joined", key: "createdAt", width: 20 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FF000000" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4AF37" } };
  for (const u of users) {
    const b = u.bankDetails || {};
    ws.addRow({
      name: u.name, username: u.username, email: u.email, mobile: u.mobile, wallet: u.wallet || 0,
      accountHolder: b.accountHolder || "", accountNumber: b.accountNumber || "",
      ifsc: b.ifsc || "", bankName: b.bankName || "", upiId: b.upiId || "",
      createdAt: u.createdAt ? new Date(u.createdAt).toLocaleString("en-IN") : "",
    });
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get("/api/admin/:type/export", authAdmin, async (req, res) => {
  const type = req.params.type;
  if (!["deposits", "withdrawals", "investments"].includes(type))
    return res.status(400).json({ error: "Invalid type" });
  const rows = await db.collection(type).find({}).toArray();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(type);
  const keys = Object.keys(rows[0] || { info: "no data" });
  ws.columns = keys.map(k => ({ header: k.toUpperCase(), key: k, width: 20 }));
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow(r));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get("/api/admin/deposits", authAdmin, async (req, res) => {
  const list = await db.collection("deposits").find({}).sort({ createdAt: -1 }).toArray();
  res.json(list.map(d => ({ ...d, _id: d._id.toString() })));
});

app.put("/api/admin/deposits/:id", authAdmin, async (req, res) => {
  const { status } = req.body;
  const dep = await db.collection("deposits").findOne({ _id: new ObjectId(req.params.id) });
  if (!dep) return res.status(404).json({ error: "Not found" });
  if (dep.status === "pending" && status === "approved") {
    await db.collection("users").updateOne({ _id: new ObjectId(dep.userId) }, { $inc: { wallet: dep.amount } });
  }
  await db.collection("deposits").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status, processedAt: new Date() } });
  res.json({ ok: true });
});

app.get("/api/admin/withdrawals", authAdmin, async (req, res) => {
  const list = await db.collection("withdrawals").find({}).sort({ createdAt: -1 }).toArray();
  res.json(list.map(w => ({ ...w, _id: w._id.toString() })));
});

app.put("/api/admin/withdrawals/:id", authAdmin, async (req, res) => {
  const { status } = req.body;
  const wd = await db.collection("withdrawals").findOne({ _id: new ObjectId(req.params.id) });
  if (!wd) return res.status(404).json({ error: "Not found" });
  if (wd.status === "pending" && status === "rejected") {
    await db.collection("users").updateOne({ _id: new ObjectId(wd.userId) }, { $inc: { wallet: wd.amount } });
  }
  await db.collection("withdrawals").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status, processedAt: new Date() } });
  res.json({ ok: true });
});

app.get("/api/admin/investments", authAdmin, async (req, res) => {
  const list = await db.collection("investments").find({}).sort({ createdAt: -1 }).toArray();
  res.json(list.map(i => ({ ...i, _id: i._id.toString() })));
});

app.get("/api/admin/plans", authAdmin, async (req, res) => {
  const list = await db.collection("plans").find({}).toArray();
  res.json(list.map(p => ({ ...p, _id: p._id.toString() })));
});

app.post("/api/admin/plans", authAdmin, async (req, res) => {
  const result = await db.collection("plans").insertOne({ ...req.body, createdAt: new Date() });
  const plan = await db.collection("plans").findOne({ _id: result.insertedId });
  res.json({ ...plan, _id: plan._id.toString() });
});

app.put("/api/admin/plans/:id", authAdmin, async (req, res) => {
  const { _id, ...data } = req.body;
  await db.collection("plans").updateOne({ _id: new ObjectId(req.params.id) }, { $set: data });
  res.json({ ok: true });
});

app.delete("/api/admin/plans/:id", authAdmin, async (req, res) => {
  await db.collection("plans").deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ ok: true });
});

app.put("/api/admin/settings/payment", authAdmin, async (req, res) => {
  await db.collection("settings").updateOne({ key: "site" }, { $set: { paymentInfo: req.body } });
  res.json({ ok: true });
});

app.put("/api/admin/settings/contact", authAdmin, async (req, res) => {
  await db.collection("settings").updateOne({ key: "site" }, { $set: { contact: req.body } });
  res.json({ ok: true });
});

// ─── QR CODE UPLOAD ───────────────────────────────────────────────────────
app.post("/api/admin/settings/qr", authAdmin, upload.single("qr"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const s = await db.collection("settings").findOne({ key: "site" });
  const oldQr = s?.paymentInfo?.qrImage;
  if (oldQr) {
    const oldPath = path.join(UPLOADS_DIR, path.basename(oldQr));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const qrUrl = `/uploads/${req.file.filename}`;
  await db.collection("settings").updateOne(
    { key: "site" },
    { $set: { "paymentInfo.qrImage": qrUrl } }
  );
  res.json({ ok: true, qrImage: qrUrl });
});

app.delete("/api/admin/settings/qr", authAdmin, async (req, res) => {
  const s = await db.collection("settings").findOne({ key: "site" });
  const oldQr = s?.paymentInfo?.qrImage;
  if (oldQr) {
    const oldPath = path.join(UPLOADS_DIR, path.basename(oldQr));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  await db.collection("settings").updateOne({ key: "site" }, { $set: { "paymentInfo.qrImage": "" } });
  res.json({ ok: true });
});

// ─── SPA Fallback (must be last) ──────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── START SERVER ─────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ Earn with Kaneez running at http://localhost:${PORT}`);
    console.log(`   Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}\n`);
  });
}).catch(err => {
  console.error("❌ Failed to connect to MongoDB:", err);
  process.exit(1);
});
