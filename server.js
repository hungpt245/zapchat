/**
 * ZapChat Server v3.1
 * - sql.js (SQLite)
 * - busboy (upload file lớn tới 2GB)
 * - nodemailer (gửi OTP quên mật khẩu qua email)
 * - WebSocket realtime – 1000+ users
 */
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const { WebSocketServer } = require('ws');
const bcrypt    = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');
const Busboy    = require('busboy');

// nodemailer – không bắt buộc (graceful nếu chưa cấu hình)
let nodemailer = null;
let mailCfg    = null;
let transporter = null;

try {
  nodemailer = require('nodemailer');
  mailCfg    = require('./email.config.js');

  if (mailCfg.user && mailCfg.user !== 'your_email@gmail.com') {
    transporter = nodemailer.createTransport({
      host:   mailCfg.host,
      port:   mailCfg.port,
      secure: mailCfg.secure,
      auth:   { user: mailCfg.user, pass: mailCfg.pass },
      tls:    { rejectUnauthorized: false },
    });
    // Kiểm tra kết nối mail
    transporter.verify((err) => {
      if (err) {
        console.warn('[Mail] ⚠️  Không kết nối được mail server:', err.message);
        console.warn('[Mail]    Chức năng quên mật khẩu sẽ không hoạt động.');
        transporter = null;
      } else {
        console.log('[Mail] ✅ Kết nối mail server OK – gửi từ:', mailCfg.user);
      }
    });
  } else {
    console.warn('[Mail] ⚠️  Chưa cấu hình email trong email.config.js');
    console.warn('[Mail]    Chức năng quên mật khẩu sẽ không hoạt động.');
  }
} catch(e) {
  console.warn('[Mail] nodemailer chưa được cài hoặc email.config.js chưa có:', e.message);
}

// ─── OTP store: { email → { otp, expires, userId } } ──────────────
const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 chữ số
}

async function sendOtpEmail(toEmail, otp, displayName) {
  if (!transporter) throw new Error('Email chưa được cấu hình. Liên hệ quản trị viên!');

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">
      <div style="background:linear-gradient(135deg,#005c4b,#00a884);padding:28px 32px;text-align:center">
        <div style="font-size:40px">💬</div>
        <h1 style="color:#fff;margin:10px 0 4px;font-size:22px;font-weight:700">ZapChat</h1>
        <p style="color:rgba(255,255,255,.8);margin:0;font-size:13px">Đặt lại mật khẩu</p>
      </div>
      <div style="padding:28px 32px">
        <p style="color:#333;font-size:15px;margin:0 0 8px">Xin chào <strong>${displayName}</strong>,</p>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px">
          Chúng tôi nhận được yêu cầu đặt lại mật khẩu tài khoản ZapChat của bạn.<br>
          Sử dụng mã OTP dưới đây để xác nhận:
        </p>
        <div style="background:#f0f2f5;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
          <div style="font-size:40px;font-weight:700;letter-spacing:12px;color:#00a884;font-family:monospace">${otp}</div>
          <p style="color:#8696a0;font-size:12px;margin:8px 0 0">Mã có hiệu lực trong <strong>10 phút</strong></p>
        </div>
        <p style="color:#888;font-size:13px;line-height:1.6;margin:0">
          Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.<br>
          Tài khoản của bạn vẫn an toàn.
        </p>
      </div>
      <div style="padding:16px 32px;background:#f8f9fa;text-align:center;border-top:1px solid #eee">
        <p style="color:#aaa;font-size:12px;margin:0">© ${new Date().getFullYear()} ZapChat – Kết nối · Chia sẻ · Trò chuyện</p>
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"${mailCfg.fromName}" <${mailCfg.user}>`,
    to:   toEmail,
    subject: `[ZapChat] Mã OTP đặt lại mật khẩu: ${otp}`,
    html,
    text: `ZapChat – Mã OTP đặt lại mật khẩu của bạn là: ${otp}\nMã có hiệu lực trong 10 phút.`,
  });
}

const PORT       = 3000;
const DB_FILE    = path.join(__dirname, 'zapchat.db');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_B = 2 * 1024 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  '.html':'text/html;charset=utf-8','.js':'application/javascript',
  '.css':'text/css','.json':'application/json','.ico':'image/x-icon',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml',
  '.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm',
  '.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav',
  '.zip':'application/zip','.rar':'application/x-rar-compressed',
  '.7z':'application/x-7z-compressed',
  '.doc':'application/msword',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':'application/vnd.ms-excel',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt':'application/vnd.ms-powerpoint',
  '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt':'text/plain','.csv':'text/csv',
};
const INLINE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.pdf','.mp4','.webm','.mp3','.ogg','.wav']);
const clients = new Map();

// ════════════════════════════════════════
//  DATABASE
// ════════════════════════════════════════
let db;
function saveDb() {
  try { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); }
  catch(e) { console.error('[DB]', e.message); }
}
let dirty = false;
function markDirty() { dirty = true; }
setInterval(() => { if (dirty) { saveDb(); dirty = false; } }, 2000);

function dbRun(sql, p=[]) {
  try { db.run(sql, p); markDirty(); }
  catch(e) { console.error('[DB] dbRun error:', e.message, '| SQL:', sql.slice(0,60)); }
}
function dbGet(sql, p=[]) {
  try {
    const s = db.prepare(sql); s.bind(p);
    const r = s.step() ? s.getAsObject() : null; s.free(); return r;
  } catch(e) {
    console.error('[DB] dbGet error:', e.message, '| SQL:', sql.slice(0,60));
    return null;
  }
}
function dbAll(sql, p=[]) {
  try {
    const s = db.prepare(sql); s.bind(p);
    const rows = []; while(s.step()) rows.push(s.getAsObject());
    s.free(); return rows;
  } catch(e) {
    console.error('[DB] dbAll error:', e.message, '| SQL:', sql.slice(0,60));
    return [];
  }
}

async function initDb() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, displayName TEXT NOT NULL,
      email TEXT UNIQUE, color TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      name TEXT, color TEXT, createdBy TEXT, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conv_members (
      convId TEXT NOT NULL, userId TEXT NOT NULL, PRIMARY KEY(convId,userId));
    CREATE TABLE IF NOT EXISTS friends (
      userId1 TEXT NOT NULL, userId2 TEXT NOT NULL,
      convId TEXT NOT NULL, PRIMARY KEY(userId1,userId2));
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, convId TEXT NOT NULL,
      fromId TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      fileType TEXT, fileName TEXT, fileSize INTEGER,
      fileMime TEXT, fileUrl TEXT, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(convId,createdAt);
    CREATE INDEX IF NOT EXISTS idx_mem_user ON conv_members(userId);
    CREATE INDEX IF NOT EXISTS idx_fr1 ON friends(userId1);
    CREATE INDEX IF NOT EXISTS idx_fr2 ON friends(userId2);
    CREATE INDEX IF NOT EXISTS idx_sess_tok ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sess_uid ON sessions(userId);
  `);
  try { db.run(`ALTER TABLE users ADD COLUMN email TEXT`); } catch(_) {}
  try { db.run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt INTEGER NOT NULL)`); } catch(_) {}
  try { db.run(`DELETE FROM sessions WHERE createdAt < ?`, [Date.now() - 30 * 24 * 60 * 60 * 1000]); } catch(_) {}
  saveDb();
  console.log('[DB] ✅ Database sẵn sàng:', DB_FILE);
}

function getPrivConvId(u1,u2) {
  const r=dbGet(`SELECT convId FROM friends WHERE (userId1=? AND userId2=?) OR (userId1=? AND userId2=?) LIMIT 1`,[u1,u2,u2,u1]);
  return r?r.convId:null;
}
function ensurePrivConv(u1,u2) {
  let cid=getPrivConvId(u1,u2); if(cid) return cid;
  cid=uuidv4();
  dbRun(`INSERT INTO conversations (id,type,name,color,createdBy,createdAt) VALUES (?,?,NULL,NULL,?,?)`,[cid,'private',u1,Date.now()]);
  dbRun(`INSERT OR IGNORE INTO conv_members VALUES (?,?)`,[cid,u1]);
  dbRun(`INSERT OR IGNORE INTO conv_members VALUES (?,?)`,[cid,u2]);
  return cid;
}
function getFriends(uid) {
  return dbAll(`SELECT u.id,u.displayName,u.color,f.convId FROM friends f JOIN users u ON u.id=f.userId2 WHERE f.userId1=?`,[uid])
    .map(f=>({id:f.id,displayName:f.displayName,color:f.color,online:clients.has(f.id),convId:f.convId}));
}
function getGroups(uid) {
  return dbAll(`SELECT c.* FROM conversations c JOIN conv_members m ON c.id=m.convId WHERE m.userId=? AND c.type='group'`,[uid])
    .map(g=>({id:g.id,type:'group',name:g.name,color:g.color,members:dbAll(`SELECT userId FROM conv_members WHERE convId=?`,[g.id]).map(r=>r.userId)}));
}
function fmtMsg(m) {
  const s=dbGet(`SELECT displayName,color FROM users WHERE id=?`,[m.fromId]);
  return {id:m.id,convId:m.convId,from:m.fromId,text:m.text||'',
    fileType:m.fileType||undefined,fileName:m.fileName||undefined,
    fileSize:m.fileSize||undefined,fileMime:m.fileMime||undefined,
    fileUrl:m.fileUrl||undefined,time:m.createdAt,
    senderName:s?s.displayName:'Unknown',senderColor:s?s.color:'#999'};
}

// ════════════════════════════════════════
//  UPLOAD – busboy
// ════════════════════════════════════════
function handleUpload(req, res, userId, convId, sender, members) {
  let responded = false;
  const reply = (code, obj) => {
    if (responded) return;
    responded = true;
    // Drain toàn bộ body còn lại để socket không treo
    if (!req.readableEnded) {
      req.resume();
    }
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    }
  };

  let bb;
  try {
    bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_B, files: 20 } });
  } catch(e) {
    return reply(400, { error: 'Content-Type không hợp lệ: ' + e.message });
  }

  const savedFiles = [], promises = [];
  let uploadAborted = false;

  bb.on('file', (field, stream, info) => {
    let filename = info.filename || '';
    try { filename = decodeURIComponent(filename); } catch(_) {}
    filename = filename.trim();
    if (!filename) { stream.resume(); return; }

    const ext   = path.extname(filename).toLowerCase();
    const mime  = info.mimeType || MIME[ext] || 'application/octet-stream';
    const id    = uuidv4(), save = id + ext;
    const fpath = path.join(UPLOAD_DIR, save);
    const dest  = fs.createWriteStream(fpath);
    let size = 0, toolarge = false;

    const p = new Promise((resolve, reject) => {
      stream.on('data', c => { size += c.length; });

      stream.on('limit', () => {
        // File quá lớn: huỷ ghi, drain stream, KHÔNG crash server
        toolarge = true;
        dest.destroy();
        fs.unlink(fpath, () => {});
        stream.resume(); // drain để không treo socket
        reject(new Error('TOO_LARGE:' + filename));
      });

      stream.pipe(dest);

      dest.on('finish', () => {
        if (toolarge) return;
        if (size === 0) { fs.unlink(fpath, () => {}); resolve(null); return; }
        savedFiles.push({ filename, save, fpath, mime, ext, size });
        resolve();
      });

      dest.on('error', err => {
        console.error('[Upload] dest write error:', err.message);
        fs.unlink(fpath, () => {});
        resolve(null); // không reject → không crash toàn bộ upload
      });

      stream.on('error', err => {
        console.error('[Upload] stream error:', err.message);
        resolve(null); // tương tự, bỏ qua file lỗi
      });
    });

    promises.push(p);
  });

  bb.on('error', err => {
    console.error('[Upload] busboy error:', err.message);
    reply(500, { error: 'Lỗi xử lý upload: ' + err.message });
  });

  bb.on('finish', () => {
    Promise.all(promises)
      .then(() => {
        const valid = savedFiles.filter(Boolean);
        if (!valid.length) return reply(400, { error: 'Không nhận được file hợp lệ! Kiểm tra dung lượng (tối đa 2 GB/file).' });

        const messages = [];
        valid.forEach(f => {
          try {
            const mid = uuidv4(), now = Date.now();
            dbRun(
              `INSERT INTO messages (id,convId,fromId,text,fileType,fileName,fileSize,fileMime,fileUrl,createdAt)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [mid, convId, userId, '', 'file', f.filename, f.size, f.mime, `/uploads/${f.save}`, now]
            );
            messages.push({
              id: mid, convId, from: userId, text: '',
              fileType: 'file', fileName: f.filename, fileSize: f.size,
              fileMime: f.mime, fileUrl: `/uploads/${f.save}`, time: now,
              senderName: sender.displayName, senderColor: sender.color,
            });
          } catch(dbErr) {
            console.error('[Upload] DB insert error:', dbErr.message);
          }
        });

        if (messages.length) {
          saveDb();
          messages.forEach(msg => {
            const out = JSON.stringify({ type: 'NEW_MSG', message: msg });
            members.forEach(mid => {
              try {
                const mws = clients.get(mid);
                if (mws && mws.readyState === 1) mws.send(out);
              } catch(wsErr) {
                console.error('[Upload] ws send error:', wsErr.message);
              }
            });
          });
        }

        reply(200, { ok: true, count: messages.length });
      })
      .catch(err => {
        const m = err.message || '';
        if (m.startsWith('TOO_LARGE:')) {
          return reply(413, { error: `File "${m.slice(10)}" vượt quá 2 GB! Vui lòng chọn file nhỏ hơn.` });
        }
        console.error('[Upload] promise error:', err.message);
        reply(500, { error: 'Lỗi server khi xử lý file.' });
      });
  });

  // Lỗi request socket – drain và trả lỗi
  req.on('error', err => {
    console.error('[Upload] request error:', err.message);
    reply(500, { error: 'Lỗi kết nối upload.' });
  });

  req.pipe(bb);
}

// ════════════════════════════════════════
//  HTTP SERVER
// ════════════════════════════════════════
const httpServer = http.createServer((req, res) => {
  // Bắt lỗi response - client đóng kết nối giữa chừng
  res.on('error', err => {
    if (err.code !== 'ERR_HTTP_HEADERS_SENT') {
      console.error('[HTTP] res error:', err.code, err.message);
    }
  });
  req.on('error', err => {
    console.error('[HTTP] req error:', err.code, err.message);
    if (!res.headersSent) {
      res.writeHead(400); res.end();
    }
  });

  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.url.split('?')[0];

  // POST /upload
  if (req.method === 'POST' && url === '/upload') {
    const userId = (req.headers['x-user-id'] || '').trim();
    const convId = (req.headers['x-conv-id'] || '').trim();

    if (!userId || !convId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Thiếu header x-user-id hoặc x-conv-id' }));
    }

    // Kiểm tra quyền trước khi nhận dữ liệu
    let conv, sender, isMem;
    try {
      conv   = dbGet(`SELECT * FROM conversations WHERE id=?`, [convId]);
      sender = dbGet(`SELECT * FROM users WHERE id=?`, [userId]);
      isMem  = dbGet(`SELECT 1 FROM conv_members WHERE convId=? AND userId=?`, [convId, userId]);
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Lỗi kiểm tra quyền' }));
    }

    if (!conv || !isMem) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Không có quyền!' }));
    }
    if (!sender) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'User không tồn tại!' }));
    }

    let members;
    try {
      members = dbAll(`SELECT userId FROM conv_members WHERE convId=?`, [convId]).map(r => r.userId);
    } catch(e) {
      members = [userId];
    }

    // Timeout 4 giờ cho file lớn
    req.socket.setTimeout(4 * 60 * 60 * 1000);

    handleUpload(req, res, userId, convId, sender, members);
    return;
  }

  // GET /uploads/:file
  if (req.method === 'GET' && url.startsWith('/uploads/')) {
    const fileName = path.basename(url);
    const filePath = path.join(UPLOAD_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404); return res.end('Not Found');
    }

    let ext, mime, size;
    try {
      ext  = path.extname(fileName).toLowerCase();
      mime = MIME[ext] || 'application/octet-stream';
      size = fs.statSync(filePath).size;
    } catch(e) {
      res.writeHead(500); return res.end('File error');
    }

    const range = req.headers.range;
    try {
      if (range) {
        const [s, e] = range.replace(/bytes=/, '').split('-');
        const start  = parseInt(s, 10) || 0;
        const end    = e ? parseInt(e, 10) : Math.min(start + 2*1024*1024 - 1, size - 1);
        if (start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Type':   mime,
          'Content-Range':  `bytes ${start}-${end}/${size}`,
          'Accept-Ranges':  'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control':  'public,max-age=86400',
        });
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', err => {
          console.error('[Serve] stream error:', err.message);
          if (!res.headersSent) res.end();
        });
        return stream.pipe(res);
      }

      res.writeHead(200, {
        'Content-Type':        mime,
        'Content-Length':      size,
        'Accept-Ranges':       'bytes',
        'Content-Disposition': INLINE_EXTS.has(ext)
          ? `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
          : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'public,max-age=86400',
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', err => {
        console.error('[Serve] stream error:', err.message);
        if (!res.headersSent) res.end();
      });
      return stream.pipe(res);
    } catch(e) {
      console.error('[Serve] error:', e.message);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    }
    return;
  }

  // Static files
  let staticPath=url==='/'?'/index.html':url;
  const fp=path.join(__dirname,staticPath);
  if(!fp.startsWith(__dirname)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(fp,(err,content)=>{
    if(err){res.writeHead(404);return res.end('Not Found');}
    const ext=path.extname(fp).toLowerCase();
    res.writeHead(200,{'Content-Type':MIME[ext]||'text/plain;charset=utf-8'});
    res.end(content);
  });
});

// Lỗi cấp HTTP server (port đang dùng, v.v.)
httpServer.on('error', err => {
  console.error('[HTTP] server error:', err.message);
});

function jsonRes(res, code, obj) {
  if (!res.headersSent) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }
}

// ════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════
const wss = new WebSocketServer({ server: httpServer, maxPayload: 10*1024*1024 });

// Lỗi cấp server WebSocket
wss.on('error', err => {
  console.error('[WSS] server error:', err.message);
});

wss.on('connection', ws => {
  let uid = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Bọc toàn bộ handler trong try/catch
    try {
      switch(msg.type) {
        case 'REGISTER':        onRegister(ws, msg); break;
        case 'LOGIN':           onLogin(ws, msg, id => { uid = id; }); break;
        case 'RESUME_SESSION':  onResumeSession(ws, msg, id => { uid = id; }); break;
        case 'LOGOUT':          onLogout(ws, msg, () => { uid = null; }); break;
        case 'FORGOT_PASSWORD': onForgotPassword(ws, msg); break;
        case 'VERIFY_OTP':      onVerifyOtp(ws, msg); break;
        case 'RESET_PASSWORD':  onResetPassword(ws, msg); break;
        case 'SEND_MSG':        onSendMsg(ws, msg, uid); break;
        case 'ADD_FRIEND':      onAddFriend(ws, msg, uid); break;
        case 'CREATE_GROUP':    onCreateGroup(ws, msg, uid); break;
        case 'GET_HISTORY':     onGetHistory(ws, msg, uid); break;
        case 'GET_CONTACTS':    onGetContacts(ws, uid); break;
        case 'SEARCH_USER':     onSearchUser(ws, msg, uid); break;
        case 'CALL_OFFER':      onCallOffer(ws, msg, uid); break;
        case 'CALL_ANSWER':     onCallAnswer(ws, msg, uid); break;
        case 'CALL_ICE':        onCallIce(ws, msg, uid); break;
        case 'CALL_REJECT':     onCallReject(ws, msg, uid); break;
        case 'CALL_END':        onCallEnd(ws, msg, uid); break;
        case 'PING':            wsSend(ws, { type: 'PONG' }); break;
      }
    } catch(e) {
      console.error('[WS] Handler error for type=' + msg.type + ':', e.message);
      // Trả lỗi cho client nhưng không crash server
      try { wsSend(ws, { type: 'ERROR', error: 'Lỗi xử lý yêu cầu.' }); } catch(_) {}
    }
  });

  ws.on('close', () => {
    if (uid) {
      if (activeCalls.has(uid)) {
        try { onCallEnd(ws, { targetUserId: activeCalls.get(uid)?.partnerId }, uid); } catch(_) {}
      }
      if (clients.get(uid) === ws) {
        clients.delete(uid);
        try { broadcastStatus(uid, false); } catch(e) {
          console.error('[WS] broadcastStatus error:', e.message);
        }
      }
    }
  });

  ws.on('error', err => {
    // Lỗi socket thông thường khi client ngắt, không cần log hết
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      console.error('[WS] socket error:', err.code, err.message);
    }
  });
});

// ════════════════════════════════════════
//  WS HANDLERS
// ════════════════════════════════════════
function onRegister(ws,msg){
  const{username,password,confirmPassword,displayName,email}=msg;
  if(!displayName?.trim()) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Vui lòng nhập họ tên!'});
  if(!username||username.length<3) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Tên đăng nhập ít nhất 3 ký tự!'});
  if(!/^[a-zA-Z0-9_.]+$/.test(username)) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Tên đăng nhập chỉ gồm chữ, số, _ và .'});
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Email không hợp lệ!'});
  if(!password||password.length<6) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Mật khẩu ít nhất 6 ký tự!'});
  if(password!==confirmPassword) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Mật khẩu xác nhận không khớp!'});
  if(dbGet(`SELECT 1 FROM users WHERE username=?`,[username.toLowerCase()])) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Tên đăng nhập đã tồn tại!'});
  if(dbGet(`SELECT 1 FROM users WHERE lower(email)=?`,[email.toLowerCase()])) return wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Email đã được sử dụng!'});
  const COLORS=['#e57373','#81c784','#64b5f6','#ffd54f','#ba68c8','#4db6ac','#ff8a65','#a1887f'];
  try{
    dbRun(`INSERT INTO users (id,username,password,displayName,email,color,createdAt) VALUES (?,?,?,?,?,?,?)`,
      [uuidv4(),username.toLowerCase(),bcrypt.hashSync(password,10),displayName.trim(),email.toLowerCase(),COLORS[Math.floor(Math.random()*COLORS.length)],Date.now()]);
    wsSend(ws,{type:'REGISTER_RES',ok:true,message:'Đăng ký thành công! Hãy đăng nhập.'});
  }catch(e){wsSend(ws,{type:'REGISTER_RES',ok:false,error:'Lỗi hệ thống: '+e.message});}
}

function onLogin(ws,msg,setUser){
  const q=(msg.username||'').toLowerCase();
  const user=dbGet(`SELECT * FROM users WHERE username=? OR lower(email)=?`,[q,q]);
  if(!user) return wsSend(ws,{type:'LOGIN_RES',ok:false,error:'Tài khoản không tồn tại!'});
  if(!bcrypt.compareSync(msg.password,user.password)) return wsSend(ws,{type:'LOGIN_RES',ok:false,error:'Sai mật khẩu!'});
  const token = uuidv4();
  dbRun(`INSERT INTO sessions (token, userId, createdAt) VALUES (?,?,?)`, [token, user.id, Date.now()]);
  clients.set(user.id,ws); setUser(user.id); broadcastStatus(user.id,true);
  wsSend(ws,{type:'LOGIN_RES',ok:true,
    token,
    user:{id:user.id,username:user.username,displayName:user.displayName,email:user.email,color:user.color},
    friends:getFriends(user.id),groups:getGroups(user.id)});
}

function onResumeSession(ws, msg, setUser) {
  const token = (msg.token || '').trim();
  if (!token) return wsSend(ws, { type: 'RESUME_SESSION_RES', ok: false, error: 'Token không hợp lệ!' });
  const sess = dbGet(`SELECT * FROM sessions WHERE token=?`, [token]);
  if (!sess) return wsSend(ws, { type: 'RESUME_SESSION_RES', ok: false, error: 'Phiên đăng nhập đã hết hạn!' });

  const user = dbGet(`SELECT * FROM users WHERE id=?`, [sess.userId]);
  if (!user) {
    dbRun(`DELETE FROM sessions WHERE token=?`, [token]);
    return wsSend(ws, { type: 'RESUME_SESSION_RES', ok: false, error: 'Người dùng không tồn tại!' });
  }

  clients.set(user.id, ws);
  setUser(user.id);
  broadcastStatus(user.id, true);

  wsSend(ws, {
    type: 'RESUME_SESSION_RES',
    ok: true,
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, color: user.color },
    friends: getFriends(user.id),
    groups: getGroups(user.id)
  });
}

function onLogout(ws, msg, clearUser) {
  const token = (msg.token || '').trim();
  if (token) {
    dbRun(`DELETE FROM sessions WHERE token=?`, [token]);
  }
  clearUser();
  wsSend(ws, { type: 'LOGOUT_RES', ok: true });
}

// ── QUÊN MẬT KHẨU ─────────────────────────────────────────────────────
async function onForgotPassword(ws, msg) {
  const email = (msg.email || '').toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return wsSend(ws, { type:'FORGOT_RES', ok:false, error:'Email không hợp lệ!' });

  const user = dbGet(`SELECT * FROM users WHERE lower(email)=?`, [email]);
  // Bảo mật: không tiết lộ email có tồn tại hay không
  if (!user) {
    return wsSend(ws, { type:'FORGOT_RES', ok:true,
      message:'Nếu email tồn tại trong hệ thống, mã OTP đã được gửi.' });
  }

  const otp = generateOTP();
  const expires = Date.now() + 10 * 60 * 1000; // 10 phút
  otpStore.set(email, { otp, expires, userId: user.id, verified: false });

  // Tự xoá OTP sau 10 phút
  setTimeout(() => {
    const entry = otpStore.get(email);
    if (entry && entry.otp === otp) otpStore.delete(email);
  }, 10 * 60 * 1000);

  try {
    await sendOtpEmail(user.email, otp, user.displayName);
    wsSend(ws, { type:'FORGOT_RES', ok:true,
      message:`Mã OTP đã được gửi tới ${maskEmail(user.email)}. Kiểm tra hộp thư (kể cả thư mục Spam).` });
  } catch(e) {
    console.error('[Mail] Lỗi gửi email:', e.message);
    wsSend(ws, { type:'FORGOT_RES', ok:false,
      error:'Không thể gửi email. Kiểm tra cấu hình email.config.js và kết nối mạng.' });
  }
}

// ── XÁC NHẬN OTP ──────────────────────────────────────────────────────
function onVerifyOtp(ws, msg) {
  const email = (msg.email || '').toLowerCase().trim();
  const otp   = (msg.otp   || '').trim();

  const entry = otpStore.get(email);
  if (!entry)
    return wsSend(ws, { type:'VERIFY_OTP_RES', ok:false, error:'Mã OTP không tồn tại hoặc đã hết hạn!' });
  if (Date.now() > entry.expires)
    return wsSend(ws, { type:'VERIFY_OTP_RES', ok:false, error:'Mã OTP đã hết hạn! Vui lòng yêu cầu mã mới.' });
  if (entry.otp !== otp)
    return wsSend(ws, { type:'VERIFY_OTP_RES', ok:false, error:'Mã OTP không đúng!' });

  // Đánh dấu OTP đã xác nhận – có thể đặt mật khẩu mới
  entry.verified = true;
  wsSend(ws, { type:'VERIFY_OTP_RES', ok:true, message:'Xác nhận thành công! Hãy nhập mật khẩu mới.' });
}

// ── ĐẶT MẬT KHẨU MỚI ─────────────────────────────────────────────────
function onResetPassword(ws, msg) {
  const email    = (msg.email    || '').toLowerCase().trim();
  const otp      = (msg.otp     || '').trim();
  const newPass  = msg.newPassword || '';
  const confPass = msg.confirmPassword || '';

  const entry = otpStore.get(email);
  if (!entry || !entry.verified || entry.otp !== otp)
    return wsSend(ws, { type:'RESET_RES', ok:false, error:'Phiên xác nhận không hợp lệ. Thực hiện lại từ đầu!' });
  if (Date.now() > entry.expires)
    return wsSend(ws, { type:'RESET_RES', ok:false, error:'Phiên đã hết hạn. Vui lòng yêu cầu mã OTP mới!' });
  if (!newPass || newPass.length < 6)
    return wsSend(ws, { type:'RESET_RES', ok:false, error:'Mật khẩu mới ít nhất 6 ký tự!' });
  if (newPass !== confPass)
    return wsSend(ws, { type:'RESET_RES', ok:false, error:'Mật khẩu xác nhận không khớp!' });

  const hash = bcrypt.hashSync(newPass, 10);
  dbRun(`UPDATE users SET password=? WHERE id=?`, [hash, entry.userId]);
  dbRun(`DELETE FROM sessions WHERE userId=?`, [entry.userId]);
  otpStore.delete(email);

  wsSend(ws, { type:'RESET_RES', ok:true, message:'Đặt lại mật khẩu thành công! Hãy đăng nhập.' });
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  const masked = user.length <= 2 ? user[0]+'*' : user.slice(0,2)+'***';
  return masked + '@' + domain;
}

// ── CÁC HANDLER KHÁC ──────────────────────────────────────────────────
function onSendMsg(ws,msg,uid){
  if(!uid) return wsSend(ws,{type:'ERROR',error:'Chưa đăng nhập!'});
  const{convId,text}=msg; if(!text?.trim()) return;
  const conv=dbGet(`SELECT * FROM conversations WHERE id=?`,[convId]);
  if(!conv||!dbGet(`SELECT 1 FROM conv_members WHERE convId=? AND userId=?`,[convId,uid])) return;
  const sender=dbGet(`SELECT displayName,color FROM users WHERE id=?`,[uid]);
  const mid=uuidv4(),now=Date.now();
  dbRun(`INSERT INTO messages (id,convId,fromId,text,createdAt) VALUES (?,?,?,?,?)`,[mid,convId,uid,text.trim(),now]);
  const out=JSON.stringify({type:'NEW_MSG',message:{id:mid,convId,from:uid,text:text.trim(),time:now,senderName:sender.displayName,senderColor:sender.color}});
  dbAll(`SELECT userId FROM conv_members WHERE convId=?`,[convId]).forEach(r=>{const mws=clients.get(r.userId);if(mws&&mws.readyState===1)mws.send(out);});
}

function onAddFriend(ws,msg,uid){
  if(!uid) return wsSend(ws,{type:'ERROR',error:'Chưa đăng nhập!'});
  const q=(msg.targetUsername||'').toLowerCase();
  const target=dbGet(`SELECT * FROM users WHERE username=? OR lower(email)=?`,[q,q]);
  if(!target) return wsSend(ws,{type:'ADD_FRIEND_RES',ok:false,error:'Không tìm thấy người dùng!'});
  if(target.id===uid) return wsSend(ws,{type:'ADD_FRIEND_RES',ok:false,error:'Không thể tự thêm mình!'});
  if(dbGet(`SELECT 1 FROM friends WHERE userId1=? AND userId2=?`,[uid,target.id])) return wsSend(ws,{type:'ADD_FRIEND_RES',ok:false,error:'Đã là bạn bè rồi!'});
  const convId=ensurePrivConv(uid,target.id);
  dbRun(`INSERT OR IGNORE INTO friends VALUES (?,?,?)`,[uid,target.id,convId]);
  dbRun(`INSERT OR IGNORE INTO friends VALUES (?,?,?)`,[target.id,uid,convId]);
  wsSend(ws,{type:'ADD_FRIEND_RES',ok:true,friend:{id:target.id,displayName:target.displayName,color:target.color,online:clients.has(target.id),convId}});
  const tws=clients.get(target.id);
  if(tws){const me=dbGet(`SELECT * FROM users WHERE id=?`,[uid]);wsSend(tws,{type:'FRIEND_ADDED',friend:{id:me.id,displayName:me.displayName,color:me.color,online:true,convId}});}
}

function onCreateGroup(ws,msg,uid){
  if(!uid) return wsSend(ws,{type:'ERROR',error:'Chưa đăng nhập!'});
  const{name,memberIds}=msg;
  if(!name?.trim()) return wsSend(ws,{type:'CREATE_GROUP_RES',ok:false,error:'Tên nhóm không được trống!'});
  if(!memberIds?.length) return wsSend(ws,{type:'CREATE_GROUP_RES',ok:false,error:'Chọn ít nhất 1 thành viên!'});
  const COLORS=['#00a884','#e57373','#64b5f6','#81c784','#ffd54f','#ba68c8'];
  const all=[...new Set([uid,...memberIds])];
  const cid=uuidv4(),color=COLORS[Math.floor(Math.random()*COLORS.length)];
  dbRun(`INSERT INTO conversations (id,type,name,color,createdBy,createdAt) VALUES (?,?,?,?,?,?)`,[cid,'group',name.trim(),color,uid,Date.now()]);
  all.forEach(mid=>dbRun(`INSERT OR IGNORE INTO conv_members VALUES (?,?)`,[cid,mid]));
  const group={id:cid,type:'group',name:name.trim(),color,members:all};
  all.forEach(mid=>{const mws=clients.get(mid);if(mws)wsSend(mws,{type:'GROUP_CREATED',group});});
}

function onGetHistory(ws,msg,uid){
  if(!uid) return;
  const conv=dbGet(`SELECT * FROM conversations WHERE id=?`,[msg.convId]);
  if(!conv||!dbGet(`SELECT 1 FROM conv_members WHERE convId=? AND userId=?`,[msg.convId,uid])) return;
  const msgs=dbAll(`SELECT * FROM messages WHERE convId=? ORDER BY createdAt ASC`,[msg.convId]).slice(-100).map(fmtMsg);
  wsSend(ws,{type:'HISTORY',convId:msg.convId,messages:msgs});
}

function onGetContacts(ws,uid){ if(!uid) return; wsSend(ws,{type:'CONTACTS',friends:getFriends(uid),groups:getGroups(uid)}); }

function onSearchUser(ws,msg,uid){
  if(!uid) return;
  const q=msg.query||''; if(q.length<2) return wsSend(ws,{type:'SEARCH_RES',results:[]});
  const like='%'+q.toLowerCase()+'%';
  wsSend(ws,{type:'SEARCH_RES',results:dbAll(`SELECT id,username,displayName,color,email FROM users WHERE id!=? AND (username LIKE ? OR lower(displayName) LIKE ? OR lower(email) LIKE ?) LIMIT 15`,[uid,like,like,like])});
}

function broadcastStatus(uid, online) {
  try {
    dbAll(`SELECT userId2 AS id FROM friends WHERE userId1=?`, [uid]).forEach(r => {
      try {
        const fws = clients.get(r.id);
        if (fws && fws.readyState === 1) wsSend(fws, { type:'PRESENCE', userId:uid, online });
      } catch(_) {}
    });
  } catch(e) {
    console.error('[WS] broadcastStatus error:', e.message);
  }
}

// ════════════════════════════════════════
//  VOICE CALL SIGNALING
// ════════════════════════════════════════
const activeCalls = new Map(); // userId -> { partnerId, convId, startTime }

function onCallOffer(ws, msg, uid) {
  if (!uid) return;
  const targetId = msg.targetUserId;
  const convId   = msg.convId;
  if (!targetId || targetId === uid) {
    return wsSend(ws, { type: 'CALL_FAILED', error: 'Người nhận không hợp lệ!' });
  }

  const targetWs = clients.get(targetId);
  if (!targetWs || targetWs.readyState !== 1) {
    return wsSend(ws, { type: 'CALL_FAILED', error: 'Người dùng hiện không online!' });
  }

  if (activeCalls.has(targetId)) {
    return wsSend(ws, { type: 'CALL_BUSY', error: 'Người dùng đang bận trong một cuộc gọi khác!' });
  }

  const caller = dbGet(`SELECT id, displayName, color FROM users WHERE id=?`, [uid]);
  if (!caller) return;

  activeCalls.set(uid, { partnerId: targetId, convId, startTime: null });
  activeCalls.set(targetId, { partnerId: uid, convId, startTime: null });

  wsSend(targetWs, {
    type: 'INCOMING_CALL',
    fromUserId: uid,
    callerName: caller.displayName,
    callerColor: caller.color,
    convId,
    sdp: msg.sdp
  });
}

function onCallAnswer(ws, msg, uid) {
  if (!uid) return;
  const targetId = msg.targetUserId;
  const targetWs = clients.get(targetId);

  const now = Date.now();
  if (activeCalls.has(uid)) activeCalls.get(uid).startTime = now;
  if (activeCalls.has(targetId)) activeCalls.get(targetId).startTime = now;

  if (targetWs && targetWs.readyState === 1) {
    wsSend(targetWs, {
      type: 'CALL_ANSWERED',
      fromUserId: uid,
      sdp: msg.sdp
    });
  }
}

function onCallIce(ws, msg, uid) {
  if (!uid) return;
  const targetId = msg.targetUserId;
  const targetWs = clients.get(targetId);
  if (targetWs && targetWs.readyState === 1) {
    wsSend(targetWs, {
      type: 'CALL_ICE',
      fromUserId: uid,
      candidate: msg.candidate
    });
  }
}

function onCallReject(ws, msg, uid) {
  if (!uid) return;
  const targetId = msg.targetUserId;
  const targetWs = clients.get(targetId);

  const c = activeCalls.get(uid);
  if (c && c.convId) {
    const mid = uuidv4(), now = Date.now();
    const caller = dbGet(`SELECT displayName, color FROM users WHERE id=?`, [c.partnerId]);
    dbRun(
      `INSERT INTO messages (id, convId, fromId, text, fileType, createdAt) VALUES (?,?,?,?,?,?)`,
      [mid, c.convId, c.partnerId, 'Cuộc gọi nhỡ', 'call_missed', now]
    );
    saveDb();
    const out = JSON.stringify({
      type: 'NEW_MSG',
      message: {
        id: mid, convId: c.convId, from: c.partnerId, text: 'Cuộc gọi nhỡ',
        fileType: 'call_missed', time: now,
        senderName: caller ? caller.displayName : 'Người dùng',
        senderColor: caller ? caller.color : '#00a884'
      }
    });
    [uid, c.partnerId].forEach(id => {
      const s = clients.get(id);
      if (s && s.readyState === 1) s.send(out);
    });
  }

  activeCalls.delete(uid);
  activeCalls.delete(targetId);

  if (targetWs && targetWs.readyState === 1) {
    wsSend(targetWs, {
      type: 'CALL_REJECTED',
      fromUserId: uid,
      reason: msg.reason || 'declined'
    });
  }
}

function onCallEnd(ws, msg, uid) {
  if (!uid) return;
  const targetId = msg?.targetUserId;
  const c = activeCalls.get(uid);

  if (c) {
    const partnerId = c.partnerId;
    const durationSec = c.startTime ? Math.round((Date.now() - c.startTime) / 1000) : 0;
    if (c.convId) {
      const mid = uuidv4(), now = Date.now();
      const durationText = durationSec > 0 ? fmtDuration(durationSec) : 'Đã kết thúc';
      const callText = `Cuộc gọi thoại • ${durationText}`;
      const callType = durationSec > 0 ? 'call_ended' : 'call_missed';
      const sender = dbGet(`SELECT displayName, color FROM users WHERE id=?`, [uid]);

      dbRun(
        `INSERT INTO messages (id, convId, fromId, text, fileType, createdAt) VALUES (?,?,?,?,?,?)`,
        [mid, c.convId, uid, callText, callType, now]
      );
      saveDb();

      const out = JSON.stringify({
        type: 'NEW_MSG',
        message: {
          id: mid, convId: c.convId, from: uid, text: callText,
          fileType: callType, time: now,
          senderName: sender ? sender.displayName : 'Người dùng',
          senderColor: sender ? sender.color : '#00a884'
        }
      });
      [uid, partnerId].forEach(id => {
        const s = clients.get(id);
        if (s && s.readyState === 1) s.send(out);
      });
    }

    activeCalls.delete(uid);
    activeCalls.delete(partnerId);

    const targetWs = clients.get(partnerId);
    if (targetWs && targetWs.readyState === 1) {
      wsSend(targetWs, { type: 'CALL_ENDED', fromUserId: uid, duration: durationSec });
    }
  } else if (targetId) {
    const targetWs = clients.get(targetId);
    if (targetWs && targetWs.readyState === 1) {
      wsSend(targetWs, { type: 'CALL_ENDED', fromUserId: uid });
    }
  }
}

function fmtDuration(s) {
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}
function wsSend(ws, data) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(data)); }
  catch(e) { /* client đã đóng kết nối, bỏ qua */ }
}

process.on('SIGINT',  ()=>{ saveDb(); console.log('\n[DB] Saved. Bye!'); process.exit(0); });
process.on('SIGTERM', ()=>{ saveDb(); process.exit(0); });

// ── BẮT LỖI TOÀN CỤC – server không bao giờ crash ────────────────────
process.on('uncaughtException', err => {
  console.error('[CRASH PREVENTED] uncaughtException:', err.message);
  console.error(err.stack);
  // Lưu DB an toàn trước khi tiếp tục
  try { saveDb(); } catch(_) {}
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH PREVENTED] unhandledRejection at:', promise, 'reason:', reason);
});

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
initDb().then(()=>{
  httpServer.listen(PORT,'0.0.0.0',()=>{
    console.log(`\n✅  ZapChat v3.1 đang chạy`);
    console.log(`🌐  http://localhost:${PORT}`);
    console.log(`🗄️   DB:     ${DB_FILE}`);
    console.log(`📂  Upload: ${UPLOAD_DIR}`);
    console.log(`📧  Mail:   ${transporter?'✅ Sẵn sàng':'⚠️  Chưa cấu hình (email.config.js)'}\n`);
  });
}).catch(e=>{console.error('❌',e);process.exit(1);});
