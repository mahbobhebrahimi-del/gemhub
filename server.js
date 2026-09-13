const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';

const ROOT = __dirname;
const SITE = path.join(ROOT, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');
const TOPUPS_FILE = path.join(DATA_DIR, 'wallet-topups.json');

const DEFAULT_PRODUCTS = [
  {id:'g100',name:'100 جم + 10 جم',price:166516,type:'gem',art:'diamond',bulkPercent:0},
  {id:'g200',name:'200 جم',price:293032,type:'gem',art:'diamond2',bulkPercent:1},
  {id:'g310',name:'310 جم',price:453610,type:'gem',art:'crate',bulkPercent:2},
  {id:'g520',name:'520 جم',price:745570,type:'gem',art:'crate2',badge:'پرفروش',bulkPercent:3},
  {id:'g1060',name:'1060 جم',price:1451140,type:'gem',art:'crate3',bulkPercent:5},
  {id:'g2180',name:'2180 جم',price:2716300,type:'gem',art:'mega',bulkPercent:7},
  {id:'g5600',name:'5600 جم',price:5392600,type:'gem',art:'mega',sold:true,bulkPercent:7},
  {id:'w',name:'کارت هفتگی',price:260000,type:'account',art:'weekly'},
  {id:'wl',name:'کارت هفتگی لایت',price:70000,type:'account',art:'weekly'},
  {id:'m',name:'کارت ماهانه',price:1600000,type:'account',art:'monthly'},
  {id:'o1',name:'افر 1 دلاری',price:140000,type:'account',art:'offer'},
  {id:'o2',name:'افر 2 دلاری',price:280000,type:'account',art:'offer'},
  {id:'o3',name:'افر 3 دلاری',price:420000,type:'account',art:'offer'},
  {id:'l6',name:'لول آپ 6',price:60000,type:'account',art:'level'},
  {id:'l10',name:'لول آپ 10',price:100000,type:'account',art:'level'},
  {id:'l15',name:'لول آپ 15',price:100000,type:'account',art:'level'},
  {id:'l20',name:'لول آپ 20',price:100000,type:'account',art:'level'},
  {id:'l25',name:'لول آپ 25',price:100000,type:'account',art:'level'},
  {id:'l30',name:'لول آپ 30',price:150000,type:'account',art:'level'},
  {id:'lf',name:'لول آپ کامل',price:650000,type:'account',art:'level',badge:'کامل'}
];

function ensureFile(file, fallback) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
}

ensureFile(ORDERS_FILE, []);
ensureFile(PRODUCTS_FILE, DEFAULT_PRODUCTS);
ensureFile(COUPONS_FILE, []);
ensureFile(TOPUPS_FILE, []);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20 * 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function auth(req, res) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.writeHead(401, {'WWW-Authenticate':'Basic realm="GEMHUB Admin"'});
    res.end('Authentication required');
    return false;
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  const u = i >= 0 ? decoded.slice(0, i) : '';
  const p = i >= 0 ? decoded.slice(i + 1) : '';
  if (u !== ADMIN_USER || p !== ADMIN_PASSWORD) {
    res.writeHead(401, {'WWW-Authenticate':'Basic realm="GEMHUB Admin"'});
    res.end('Invalid credentials');
    return false;
  }
  return true;
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

const encryptionSecret = process.env.ORDER_ENCRYPTION_KEY || ADMIN_PASSWORD;
const key = crypto.createHash('sha256').update(String(encryptionSecret)).digest();

function encrypt(value) {
  if (value == null || value === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map(b => b.toString('base64')).join('.');
}

function decrypt(value) {
  if (!value) return '';
  try {
    const [ivB64, tagB64, dataB64] = String(value).split('.');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (_) {
    return '';
  }
}

function sanitizeOrderForPublic(order) {
  if (!order) return null;
  return {
    orderCode: order.orderCode,
    playerId: order.playerId,
    phone: order.phone,
    total: order.total,
    subtotal: order.subtotal,
    discount: order.discount,
    couponCode: order.couponCode || '',
    items: order.items || [],
    orderType: order.orderType || '',
    status: order.status || 'new',
    statusReason: order.statusReason || '',
    statusLabel: statusLabel(order.status),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function statusLabel(status) {
  return ({
    new: 'جدید',
    reviewed: 'در حال بررسی',
    approved: 'تأیید شد',
    processing: 'در حال انجام',
    done: 'انجام شد',
    cancelled: 'لغو شد'
  })[status] || status || 'جدید';
}

function productList() {
  return readJson(PRODUCTS_FILE, DEFAULT_PRODUCTS);
}

function validProductItems(items) {
  const products = productList();
  const map = new Map(products.map(p => [p.id, p]));
  if (!Array.isArray(items) || !items.length) return null;
  return items.map(item => {
    const p = map.get(item.id);
    if (!p || p.sold) return null;
    const qty = Math.max(1, Math.min(100, Number(item.qty) || 1));
    return {
      id: p.id,
      name: p.name,
      qty,
      price: Number(p.price) || 0,
      type: p.type || ''
    };
  });
}

function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function findCoupon(code) {
  if (!code) return null;
  const coupons = readJson(COUPONS_FILE, []);
  return coupons.find(c =>
    String(c.code || '').trim().toUpperCase() === String(code).trim().toUpperCase() &&
    c.active !== false
  ) || null;
}

function applyCoupon(coupon, subtotal) {
  if (!coupon) return {discount: 0, total: subtotal};
  const now = Date.now();
  if (coupon.expiresAt && now > new Date(coupon.expiresAt).getTime()) {
    return {discount: 0, total: subtotal};
  }
  if (coupon.minSubtotal && subtotal < Number(coupon.minSubtotal)) {
    return {discount: 0, total: subtotal};
  }
  if (coupon.maxUses && Number(coupon.used || 0) >= Number(coupon.maxUses)) {
    return {discount: 0, total: subtotal};
  }
  let discount = 0;
  if (coupon.type === 'percent') discount = Math.floor(subtotal * Math.min(100, Math.max(0, Number(coupon.value) || 0)) / 100);
  else discount = Math.max(0, Math.min(subtotal, Number(coupon.value) || 0));
  return {discount, total: Math.max(0, subtotal - discount)};
}

function makeCode(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
