const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const SITE_FILE = path.join(ROOT, "index.html");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const COUPONS_FILE = path.join(DATA_DIR, "coupons.json");
const TOPUPS_FILE = path.join(DATA_DIR, "wallet-topups.json");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";
const ENCRYPTION_SECRET =
  process.env.ORDER_ENCRYPTION_KEY || ADMIN_PASSWORD || "gemhub-secret";

const KEY = crypto
  .createHash("sha256")
  .update(String(ENCRYPTION_SECRET))
  .digest();

const DEFAULT_PRODUCTS = [
  { id:"g100", name:"100 جم + 10 جم", price:166516, type:"gem", art:"diamond", bulkPercent:0 },
  { id:"g200", name:"200 جم", price:293032, type:"gem", art:"diamond2", bulkPercent:1 },
  { id:"g310", name:"310 جم", price:453610, type:"gem", art:"crate", bulkPercent:2 },
  { id:"g520", name:"520 جم", price:745570, type:"gem", art:"crate2", badge:"پرفروش", bulkPercent:3 },
  { id:"g1060", name:"1060 جم", price:1451140, type:"gem", art:"crate3", bulkPercent:5 },
  { id:"g2180", name:"2180 جم", price:2716300, type:"gem", art:"mega", bulkPercent:7 },
  { id:"g5600", name:"5600 جم", price:5392600, type:"gem", art:"mega", sold:true, bulkPercent:7 },
  { id:"w", name:"کارت هفتگی", price:260000, type:"account", art:"weekly" },
  { id:"wl", name:"کارت هفتگی لایت", price:70000, type:"account", art:"weekly" },
  { id:"m", name:"کارت ماهانه", price:1600000, type:"account", art:"monthly" },
  { id:"o1", name:"افر 1 دلاری", price:140000, type:"account", art:"offer" },
  { id:"o2", name:"افر 2 دلاری", price:280000, type:"account", art:"offer" },
  { id:"o3", name:"افر 3 دلاری", price:420000, type:"account", art:"offer" },
  { id:"l6", name:"لول آپ 6", price:60000, type:"account", art:"level" },
  { id:"l10", name:"لول آپ 10", price:100000, type:"account", art:"level" },
  { id:"l15", name:"لول آپ 15", price:100000, type:"account", art:"level" },
  { id:"l20", name:"لول آپ 20", price:100000, type:"account", art:"level" },
  { id:"l25", name:"لول آپ 25", price:100000, type:"account", art:"level" },
  { id:"l30", name:"لول آپ 30", price:150000, type:"account", art:"level" },
  { id:"lf", name:"لول آپ کامل", price:650000, type:"account", art:"level", badge:"کامل" }
];

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const defaults = [
    [ORDERS_FILE, []],
    [PRODUCTS_FILE, DEFAULT_PRODUCTS],
    [COUPONS_FILE, []],
    [TOPUPS_FILE, []]
  ];
  for (const [file, value] of defaults) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
    }
  }
}
ensureData();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, type="text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(text);
}

function sendHtml(res, status, html) {
  sendText(res, status, html, "text/html; charset=utf-8");
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 25 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function encrypt(value) {
  if (value == null || value === "") return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(x => x.toString("base64")).join(".");
}

function decrypt(value) {
  if (!value) return "";
  try {
    const parts = String(value).split(".");
    if (parts.length !== 3) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      KEY,
      Buffer.from(parts[0], "base64")
    );
    decipher.setAuthTag(Buffer.from(parts[1], "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function orderStatusLabel(status) {
  return ({
    new: "جدید",
    reviewed: "در حال بررسی",
    approved: "تأیید شد",
    processing: "در حال انجام",
    done: "انجام شد",
    cancelled: "لغو شد"
  })[status] || status || "جدید";
}

function publicOrder(order) {
  if (!order) return null;
  return {
    orderCode: order.orderCode,
    playerId: order.playerId || "",
    phone: order.phone || "",
    total: Number(order.total || 0),
    subtotal: Number(order.subtotal || 0),
    discount: Number(order.discount || 0),
    couponCode: order.couponCode || "",
    items: order.items || [],
    orderType: order.orderType || "",
    status: order.status || "new",
    statusReason: order.statusReason || "",
    statusLabel: orderStatusLabel(order.status),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function getProducts() {
  return readJson(PRODUCTS_FILE, DEFAULT_PRODUCTS);
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const products = getProducts();
  const map = new Map(products.map(p => [String(p.id), p]));

  const result = [];
  for (const item of items) {
    const product = map.get(String(item.id));
    if (!product || product.sold) return null;
    const qty = Math.max(1, Math.min(100, Number(item.qty) || 1));
    result.push({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      qty,
      type: product.type || ""
    });
  }
  return result;
}

function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function findCoupon(code) {
  if (!code) return null;
  const coupons = readJson(COUPONS_FILE, []);
  const wanted = String(code).trim().toUpperCase();
  return coupons.find(c =>
    String(c.code || "").trim().toUpperCase() === wanted &&
    c.active !== false
  ) || null;
}

function calculateCoupon(coupon, amount) {
  if (!coupon) return { discount: 0, total: amount };
  if (coupon.expiresAt && Date.now() > new Date(coupon.expiresAt).getTime()) {
    return { discount: 0, total: amount };
  }
  if (coupon.minSubtotal && amount < Number(coupon.minSubtotal)) {
    return { discount: 0, total: amount };
  }
  if (coupon.maxUses && Number(coupon.used || 0) >= Number(coupon.maxUses)) {
    return { discount: 0, total: amount };
  }

  let discount = 0;
  if (coupon.type === "percent") {
    const percent = Math.min(100, Math.max(0, Number(coupon.value) || 0));
    discount = Math.floor(amount * percent / 100);
  } else {
    discount = Math.max(0, Math.min(amount, Number(coupon.value) || 0));
  }

  return { discount, total: Math.max(0, amount - discount) };
}

function makeCode(prefix="GH") {
  return prefix + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function basicAuth(req, res) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="GEMHUB Admin"' });
    res.end("Authentication required");
    return false;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const index = decoded.indexOf(":");
  const user = index >= 0 ? decoded.slice(0, index) : "";
  const pass = index >= 0 ? decoded.slice(index + 1) : "";

  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="GEMHUB Admin"' });
    res.end("Invalid credentials");
    return false;
  }
  return true;
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function adminPage() {
  const orders = readJson(ORDERS_FILE, []);
  const rows = orders.slice().reverse().map(o => `
    <tr>
      <td>${esc(o.orderCode)}</td>
      <td>${esc(o.playerId || "-")}</td>
      <td>${esc((o.items || []).map(x => `${x.name} × ${x.qty}`).join("، "))}</td>
      <td>${Number(o.total || 0).toLocaleString("fa-IR")} تومان</td>
      <td>${esc(orderStatusLabel(o.status))}</td>
      <td>${esc(o.createdAt || "")}</td>
      <td>
        <form method="post" action="/admin/status" style="display:flex;gap:6px">
          <input type="hidden" name="code" value="${esc(o.orderCode)}">
          <select name="status">
            ${["new","reviewed","approved","processing","done","cancelled"].map(s =>
              `<option value="${s}" ${o.status===s ? "selected" : ""}>${esc(orderStatusLabel(s))}</option>`
            ).join("")}
          </select>
          <input name="reason" placeholder="توضیح">
          <button>ذخیره</button>
        </form>
      </td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GEMHUB Admin</title>
<style>
body{margin:0;background:#050b18;color:#f7f9ff;font-family:Tahoma,Arial,sans-serif;padding:20px}
.wrap{max-width:1200px;margin:auto}
h1{color:#55e7ff}
.card{border:1px solid #174d82;border-radius:18px;background:#07152d;padding:18px;margin-bottom:18px;overflow:auto}
table{width:100%;border-collapse:collapse;min-width:900px}
th,td{padding:11px;border-bottom:1px solid #163e65;text-align:right;vertical-align:top}
th{color:#5fe9ff}
select,input,button{border:1px solid #215d91;background:#081a34;color:#fff;border-radius:8px;padding:8px}
button{background:linear-gradient(100deg,#087ff2,#7135ff);font-weight:bold}
a{color:#60e8ff}
</style>
</head>
<body>
<div class="wrap">
<h1>GEMHUB | پنل مدیریت</h1>
<div class="card">تعداد سفارش‌ها: <b>${orders.length}</b></div>
<div class="card">
<table>
<thead><tr><th>کد</th><th>پلیر</th><th>محصولات</th><th>مبلغ</th><th>وضعیت</th><th>تاریخ</th><th>مدیریت</th></tr></thead>
<tbody>${rows || `<tr><td colspan="7">هنوز سفارشی ثبت نشده است.</td></tr>`}</tbody>
</table>
</div>
</div>
</body>
</html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type,Authorization"
    });
    return res.end();
  }

  if (pathname === "/health" || pathname === "/api/health") {
    return sendJson(res, 200, { ok:true, service:"GEMHUB", time:new Date().toISOString() });
  }

  if (pathname === "/api/products" && req.method === "GET") {
    return sendJson(res, 200, { products:getProducts() });
  }

  if (pathname === "/api/coupons/validate" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const amount = Math.max(0, Number(body.subtotal || 0));
      const coupon = findCoupon(body.code);
      if (!coupon) return sendJson(res, 404, { ok:false, message:"کد تخفیف معتبر نیست" });
      const result = calculateCoupon(coupon, amount);
      return sendJson(res, 200, {
        ok:true,
        code:coupon.code,
        discount:result.discount,
        total:result.total
      });
    } catch (e) {
      return sendJson(res, 400, { ok:false, message:e.message });
    }
  }

  if (pathname === "/api/orders" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const items = validateItems(body.items);
      if (!items) return sendJson(res, 400, { ok:false, message:"محصولات سفارش معتبر نیستند" });

      const sub = subtotal(items);
      const coupon = findCoupon(body.couponCode);
      const couponResult = calculateCoupon(coupon, sub);

      const now = new Date().toISOString();
      const orderCode = String(body.orderCode || makeCode("GH")).trim() || makeCode("GH");

      const order = {
        orderCode,
        playerId: String(body.playerId || "").trim(),
        phone: String(body.phone || "").trim(),
        total: couponResult.total,
        subtotal: sub,
        discount: couponResult.discount,
        couponCode: coupon ? String(coupon.code) : "",
        items,
        orderType: String(body.orderType || "").trim(),
        paymentMethod: String(body.paymentMethod || "card_to_card"),
        receiptData: body.receiptData ? String(body.receiptData) : "",
        accountEmail: encrypt(body.accountEmail),
        accountPassword: encrypt(body.accountPassword),
        accountBackup: encrypt(body.accountBackup),
        status: "new",
        statusReason: "",
        createdAt: now,
        updatedAt: now
      };

      const orders = readJson(ORDERS_FILE, []);
      const existing = orders.findIndex(o => o.orderCode === orderCode);
      if (existing >= 0) orders[existing] = order;
      else orders.push(order);
      writeJson(ORDERS_FILE, orders);

      if (coupon) {
        const coupons = readJson(COUPONS_FILE, []);
        const index = coupons.findIndex(c => String(c.code).toUpperCase() === String(coupon.code).toUpperCase());
        if (index >= 0) {
          coupons[index].used = Number(coupons[index].used || 0) + 1;
          writeJson(COUPONS_FILE, coupons);
        }
      }

      return sendJson(res, 201, { ok:true, order:publicOrder(order) });
    } catch (e) {
      return sendJson(res, 400, { ok:false, message:e.message });
    }
  }

  if (pathname.startsWith("/api/orders/") && req.method === "GET") {
    const code = decodeURIComponent(pathname.slice("/api/orders/".length)).trim();
    const orders = readJson(ORDERS_FILE, []);
    const order = orders.find(o => String(o.orderCode).toUpperCase() === code.toUpperCase());
    if (!order) return sendJson(res, 404, { ok:false, message:"سفارش پیدا نشد" });
    return sendJson(res, 200, { ok:true, order:publicOrder(order) });
  }

  if (pathname === "/api/orders" && req.method === "GET") {
    if (!basicAuth(req, res)) return;
    const orders = readJson(ORDERS_FILE, []);
    return sendJson(res, 200, { ok:true, orders });
  }

  if (pathname === "/api/wallet-topups" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const topups = readJson(TOPUPS_FILE, []);
      const topup = {
        id: makeCode("TOP"),
        phone: String(body.phone || ""),
        amount: Number(body.amount || 0),
        receiptData: String(body.receiptData || ""),
        status: "new",
        createdAt: new Date().toISOString()
      };
      topups.push(topup);
      writeJson(TOPUPS_FILE, topups);
      return sendJson(res, 201, { ok:true, topup:{ id:topup.id, status:topup.status, createdAt:topup.createdAt } });
    } catch (e) {
      return sendJson(res, 400, { ok:false, message:e.message });
    }
  }

  if (pathname === "/admin" && req.method === "GET") {
    if (!basicAuth(req, res)) return;
    return sendHtml(res, 200, adminPage());
  }

  if (pathname === "/admin/status" && req.method === "POST") {
    if (!basicAuth(req, res)) return;
    try {
      const body = await parseBody(req).catch(async () => {
        let raw = "";
        req.on("data", c => raw += c);
        return new URLSearchParams(raw);
      });

      const code = String(body.code || "").trim();
      const status = String(body.status || "new").trim();
      const reason = String(body.reason || "").trim();
      const allowed = new Set(["new","reviewed","approved","processing","done","cancelled"]);
      if (!allowed.has(status)) return sendText(res, 400, "Invalid status");

      const orders = readJson(ORDERS_FILE, []);
      const index = orders.findIndex(o => String(o.orderCode) === code);
      if (index < 0) return sendText(res, 404, "Order not found");

      orders[index].status = status;
      orders[index].statusReason = reason;
      orders[index].updatedAt = new Date().toISOString();
      writeJson(ORDERS_FILE, orders);

      res.writeHead(303, { Location:"/admin" });
      return res.end();
    } catch (e) {
      return sendText(res, 400, e.message);
    }
  }

  if (pathname === "/" || pathname === "/index.html") {
    if (!fs.existsSync(SITE_FILE)) return sendText(res, 404, "index.html not found");
    res.writeHead(200, {
      "Content-Type":"text/html; charset=utf-8",
      "Cache-Control":"no-store"
    });
    return fs.createReadStream(SITE_FILE).pipe(res);
  }

  return sendText(res, 404, "Not found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok:false, message:"Server error" });
    else res.end();
  });
});

server.on("error", err => {
  console.error("GEMHUB server error:", err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`GEMHUB server running on http://${HOST}:${PORT}`);
});
