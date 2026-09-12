const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const SITE = path.join(__dirname, 'gemhub.html');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

function sendTelegram(text){
  if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return Promise.resolve();
  return new Promise((resolve)=>{
    const data=JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,parse_mode:'HTML'});
    const req=https.request({hostname:'api.telegram.org',path:`/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},r=>{r.on('data',()=>{});r.on('end',resolve)});
    req.on('error',resolve);
    req.write(data);req.end();
  });
}

function loadOrders(){
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE,'utf8')); }
  catch { return []; }
}
function saveOrders(orders){ fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders,null,2), 'utf8'); }
function json(res,status,data){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function parseBody(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)}});req.on('error',reject)})}
function auth(req,res){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Basic ')){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Gem Hub Admin"'});res.end('Authentication required');return false}
  const decoded=Buffer.from(h.slice(6),'base64').toString();
  const i=decoded.indexOf(':');
  const u=decoded.slice(0,i), p=decoded.slice(i+1);
  if(u!==ADMIN_USER||p!==ADMIN_PASSWORD){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Gem Hub Admin"'});res.end('Invalid credentials');return false}
  return true;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function adminHtml(){
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>پنل سفارشات جم هاب</title><style>body{margin:0;background:#f5f7fb;font-family:Tahoma,Arial;color:#172033}.wrap{width:min(1100px,94%);margin:30px auto}.head{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:20px}.card{background:#fff;border:1px solid #e5eaf2;border-radius:18px;padding:18px;margin:12px 0;box-shadow:0 8px 25px #1a2b4a0a}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.muted{color:#718096;font-size:12px}.pill{display:inline-block;background:#eaf2ff;color:#1267e8;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:bold}button{border:0;border-radius:10px;padding:9px 12px;background:#1769ff;color:#fff;font-family:inherit;cursor:pointer}select{padding:8px;border:1px solid #dfe5ee;border-radius:9px;font-family:inherit}@media(max-width:650px){.row{grid-template-columns:1fr}.head{align-items:flex-start;flex-direction:column}}</style></head><body><div class="wrap"><div class="head"><div><h1>📦 پنل سفارشات جم هاب</h1><div class="muted">سفارش‌های جدید مستقیماً اینجا ذخیره و نمایش داده می‌شوند.</div></div><button onclick="load()">↻ بروزرسانی</button></div><div id="list">در حال بارگذاری...</div></div><script>async function load(){let r=await fetch('/api/admin/orders');let d=await r.json();let el=document.querySelector('#list');if(!d.ok||!d.orders.length){el.innerHTML='<div class="card">هنوز سفارشی ثبت نشده است.</div>';return}el.innerHTML=d.orders.map(o=>\`<div class="card"><div class="row"><div><span class="pill">\${o.orderCode}</span><h3>\${o.items.map(i=>i.name+' × '+i.qty).join('، ')}</h3><div>Player ID: <b>\${o.playerId}</b></div><div>پلتفرم: \${o.platform||'—'}</div><div>شماره تماس: \${o.phone||'—'}</div></div><div><div><b>\${Number(o.total).toLocaleString('fa-IR')} تومان</b></div><div class="muted">\${new Date(o.createdAt).toLocaleString('fa-IR')}</div><br><label>وضعیت: <select onchange="status('\${o.orderCode}',this.value)"><option \${o.status==='new'?'selected':''} value="new">جدید</option><option \${o.status==='processing'?'selected':''} value="processing">در حال انجام</option><option \${o.status==='done'?'selected':''} value="done">انجام شد</option><option \${o.status==='cancelled'?'selected':''} value="cancelled">لغو شد</option></select></label></div></div></div>\`).join('')}async function status(code,s){await fetch('/api/admin/orders/'+encodeURIComponent(code),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})});load()}load();setInterval(load,15000)</script></body></html>`;
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/gemhub.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return fs.createReadStream(SITE).pipe(res)}
    if(req.method==='POST'&&url.pathname==='/api/orders'){
      const o=await parseBody(req);
      if(!o.orderCode||!o.playerId||!Array.isArray(o.items)||!o.items.length)return json(res,400,{ok:false,error:'اطلاعات سفارش ناقص است'});
      const orders=loadOrders();
      o.status='new';o.statusLabel='جدید';o.createdAt=o.createdAt||new Date().toISOString();
      orders.unshift(o);saveOrders(orders);
      const itemText=o.items.map(i=>`${i.name} × ${i.qty}`).join('، ');
      const msg=`🛒 <b>سفارش جدید جم هاب</b>\n\n🔢 کد سفارش: <b>${esc(o.orderCode)}</b>\n🎮 Player ID: <b>${esc(o.playerId)}</b>\n📱 پلتفرم: ${esc(o.platform||'—')}\n📞 شماره تماس: ${esc(o.phone||'—')}\n💎 محصولات: ${esc(itemText)}\n💰 مبلغ: <b>${Number(o.total).toLocaleString('fa-IR')} تومان</b>`;
      sendTelegram(msg);
      return json(res,200,{ok:true,orderCode:o.orderCode});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/orders/')){
      const code=decodeURIComponent(url.pathname.split('/').pop());const o=loadOrders().find(x=>x.orderCode===code);
      return o?json(res,200,{ok:true,order:{orderCode:o.orderCode,total:o.total,status:o.status,statusLabel:{new:'جدید',processing:'در حال انجام',done:'انجام شد',cancelled:'لغو شد'}[o.status]||'جدید'}}):json(res,404,{ok:false});
    }
    if(url.pathname==='/admin'){
      if(!auth(req,res))return;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(adminHtml());
    }
    if(url.pathname==='/api/admin/orders'){
      if(!auth(req,res))return;return json(res,200,{ok:true,orders:loadOrders()});
    }
    if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/orders/')){
      if(!auth(req,res))return;const code=decodeURIComponent(url.pathname.split('/').pop());const body=await parseBody(req);const orders=loadOrders();const o=orders.find(x=>x.orderCode===code);if(!o)return json(res,404,{ok:false});o.status=body.status;o.statusLabel={new:'جدید',processing:'در حال انجام',done:'انجام شد',cancelled:'لغو شد'}[body.status]||'جدید';saveOrders(orders);return json(res,200,{ok:true});
    }
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');
  }catch(e){console.error(e);json(res,500,{ok:false,error:'خطای داخلی سرور'})}
});
server.listen(PORT,()=>console.log(`Gem Hub running on http://localhost:${PORT}`));
