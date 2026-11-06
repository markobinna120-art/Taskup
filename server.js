// TaskAll Backend - Admin: markobinna120@gmail.com
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());
const db = new Database('taskall.db');
const JWT_SECRET = 'taskall-secret-change-this-12345';
const ADMIN_EMAIL = 'markobinna120@gmail.com';

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT UNIQUE, username TEXT UNIQUE,
  password TEXT, ref_code TEXT UNIQUE, referred_by TEXT,
  earning_balance INTEGER DEFAULT 0,
  ad_balance INTEGER DEFAULT 0,
  total_withdrawn INTEGER DEFAULT 0,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER, title TEXT, platform TEXT,
  pay INTEGER, slots INTEGER, slots_left INTEGER,
  link TEXT, status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, task_id INTEGER, proof_text TEXT,
  status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, amount INTEGER, bank TEXT,
  status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, type TEXT, amount INTEGER,
  status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

if (db.prepare('SELECT COUNT(*) c FROM tasks').get().c === 0) {
  const ins = db.prepare('INSERT INTO tasks (creator_id,title,platform,pay,slots,slots_left,link) VALUES (0,?,?,?,?,?,?)');
  ins.run('Subscribe to a YouTube Channel','YouTube',6,1000,944,'https://youtube.com');
  ins.run('Follow Instagram Account','Instagram',8,500,500,'https://instagram.com');
  ins.run('Like TikTok Video','TikTok',5,1200,1200,'https://tiktok.com');
}

function makeRefCode(){ return Math.floor(100000+Math.random()*900000).toString(); }
function auth(req,res,next){
  const h = req.headers.authorization;
  if(!h) return res.status(401).json({error:'No token'});
  try{ req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch(e){ return res.status(401).json({error:'Invalid token'}); }
}
function adminOnly(req,res,next){
  if(req.user.email !== ADMIN_EMAIL) return res.status(403).json({error:'Admin only'});
  next();
}

app.post('/api/register', (req,res)=>{
  const {name,email,username,password,ref} = req.body;
  if(!name||!email||!password) return res.status(400).json({error:'Fill all fields'});
  const lower = email.toLowerCase().trim();
  if(lower === ADMIN_EMAIL) return res.status(400).json({error:'Email reserved for Admin'});
  const hash = bcrypt.hashSync(password,10);
  const ref_code = makeRefCode();
  try{
    const info = db.prepare('INSERT INTO users (name,email,username,password,ref_code,referred_by) VALUES (?,?,?,?,?,?)').run(name, lower, username||('user'+ref_code), hash, ref_code, ref||null);
    const user = db.prepare('SELECT id,name,email,username,ref_code,earning_balance,ad_balance,role FROM users WHERE id=?').get(info.lastInsertRowid);
    const token = jwt.sign({id:user.id,email:user.email}, JWT_SECRET);
    res.json({token,user});
  }catch(e){ res.status(400).json({error:'Email or username already exists'}); }
});

app.post('/api/login', (req,res)=>{
  const {email,password} = req.body;
  const lower = email.toLowerCase().trim();
  let user = db.prepare('SELECT * FROM users WHERE email=?').get(lower);
  if(!user && lower === ADMIN_EMAIL){
    const hash = bcrypt.hashSync('TaskAllAdmin123',10);
    const info = db.prepare("INSERT INTO users (name,email,username,password,ref_code,role) VALUES ('Admin - Mark',?, 'admin', ?, 'ADMIN','admin')").run(lower, hash);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    return res.json({token: jwt.sign({id:user.id,email:user.email}, JWT_SECRET), user: {id:user.id,name:user.name,email:user.email,username:user.username,role:user.role}, message:'Admin created. Password is TaskAllAdmin123'});
  }
  if(!user) return res.status(400).json({error:'User not found'});
  if(!bcrypt.compareSync(password, user.password)) return res.status(400).json({error:'Wrong password'});
  const token = jwt.sign({id:user.id,email:user.email}, JWT_SECRET);
  res.json({token, user:{id:user.id,name:user.name,email:user.email,username:user.username,earning_balance:user.earning_balance,ad_balance:user.ad_balance,role:user.role,ref_code:user.ref_code}});
});

app.get('/api/me', auth, (req,res)=>{
  const u = db.prepare('SELECT id,name,email,username,earning_balance,ad_balance,total_withdrawn,role,ref_code,created_at FROM users WHERE id=?').get(req.user.id);
  res.json(u);
});
app.get('/api/tasks', (req,res)=>{
  const tasks = db.prepare('SELECT * FROM tasks WHERE status="active" ORDER BY id DESC').all();
  res.json(tasks);
});

app.post('/api/tasks', auth, (req,res)=>{
  const {title,platform,pay,slots,link} = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const cost = pay * slots;
  const isAdmin = req.user.email === ADMIN_EMAIL;
  if(!isAdmin){
    if(user.ad_balance < cost) return res.status(400).json({error:`Need ₦${cost} ad balance`});
    db.prepare('UPDATE users SET ad_balance=ad_balance-? WHERE id=?').run(cost, user.id);
  }
  const info = db.prepare('INSERT INTO tasks (creator_id,title,platform,pay,slots,slots_left,link) VALUES (?,?,?,?,?,?,?)').run(user.id, title, platform, pay, slots, slots, link||'');
  res.json({id:info.lastInsertRowid, message:'Task created'});
});

app.delete('/api/tasks/:id', auth, adminOnly, (req,res)=>{
  db.prepare('UPDATE tasks SET status="deleted" WHERE id=?').run(req.params.id);
  res.json({message:'Deleted'});
});

app.post('/api/proofs', auth, (req,res)=>{
  const {task_id, proof_text} = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(task_id);
  if(!task) return res.status(404).json({error:'Task not found'});
  const exists = db.prepare('SELECT * FROM proofs WHERE user_id=? AND task_id=? AND status IN ("pending","approved")').get(req.user.id, task_id);
  if(exists) return res.status(400).json({error:'Already submitted'});
  const info = db.prepare('INSERT INTO proofs (user_id,task_id,proof_text) VALUES (?,?,?)').run(req.user.id, task_id, proof_text);
  res.json({id:info.lastInsertRowid, message:'Proof sent to admin'});
});

app.post('/api/deposit', auth, (req,res)=>{
  const {amount} = req.body;
  db.prepare('UPDATE users SET ad_balance=ad_balance+? WHERE id=?').run(amount, req.user.id);
  db.prepare('INSERT INTO transactions (user_id,type,amount,status) VALUES (?,?,?,?)').run(req.user.id,'Deposit',amount,'Approved');
  res.json({message:'Deposited'});
});

app.post('/api/withdraw', auth, (req,res)=>{
  const {amount,bank} = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if(amount < 500) return res.status(400).json({error:'Minimum ₦500'});
  if(amount > user.earning_balance) return res.status(400).json({error:'Insufficient balance'});
  db.prepare('UPDATE users SET earning_balance=earning_balance-? WHERE id=?').run(amount, user.id);
  const info = db.prepare('INSERT INTO withdrawals (user_id,amount,bank) VALUES (?,?,?)').run(user.id, amount, bank);
  db.prepare('INSERT INTO transactions (user_id,type,amount,status) VALUES (?,?,?,?)').run(user.id,'Withdrawal',-amount,'Pending');
  res.json({id:info.lastInsertRowid, message:'Withdrawal sent to admin'});
});

app.get('/api/transactions', auth, (req,res)=>{
  const tx = db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json(tx);
});

app.get('/api/admin/stats', auth, adminOnly, (req,res)=>{
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const proofs = db.prepare("SELECT COUNT(*) c FROM proofs WHERE status='pending'").get().c;
  const wd = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c;
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM withdrawals WHERE status='approved'").get().s;
  res.json({users, pendingProofs:proofs, pendingWithdrawals:wd, totalPaid:paid});
});

app.get('/api/admin/proofs', auth, adminOnly, (req,res)=>{
  const rows = db.prepare(`SELECT proofs.*, users.email as user_email, tasks.title as task_title, tasks.pay FROM proofs JOIN users ON users.id=proofs.user_id JOIN tasks ON tasks.id=proofs.task_id WHERE proofs.status='pending' ORDER BY proofs.id DESC`).all();
  res.json(rows);
});

app.post('/api/admin/proofs/:id/:action', auth, adminOnly, (req,res)=>{
  const p = db.prepare('SELECT * FROM proofs WHERE id=?').get(req.params.id);
  if(!p) return res.status(404).json({error:'Not found'});
  if(req.params.action==='approve'){
    db.prepare("UPDATE proofs SET status='approved' WHERE id=?").run(p.id);
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(p.task_id);
    db.prepare('UPDATE users SET earning_balance=earning_balance+? WHERE id=?').run(task.pay, p.user_id);
    db.prepare('UPDATE tasks SET slots_left=slots_left-1 WHERE id=?').run(p.task_id);
    db.prepare('INSERT INTO transactions (user_id,type,amount,status) VALUES (?,?,?,?)').run(p.user_id,'Task Earning',task.pay,'Approved');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);
    if(user.referred_by){
      const refUser = db.prepare('SELECT * FROM users WHERE ref_code=?').get(user.referred_by);
      if(refUser) db.prepare('UPDATE users SET earning_balance=earning_balance+? WHERE id=?').run(Math.floor(task.pay*0.1), refUser.id);
    }
  } else {
    db.prepare("UPDATE proofs SET status='rejected' WHERE id=?").run(p.id);
  }
  res.json({message:'Done'});
});

app.get('/api/admin/withdrawals', auth, adminOnly, (req,res)=>{
  const rows = db.prepare(`SELECT withdrawals.*, users.email as user_email FROM withdrawals JOIN users ON users.id=withdrawals.user_id WHERE withdrawals.status='pending' ORDER BY withdrawals.id DESC`).all();
  res.json(rows);
});

app.post('/api/admin/withdrawals/:id/:action', auth, adminOnly, (req,res)=>{
  const w = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if(!w) return res.status(404).json({error:'Not found'});
  if(req.params.action==='approve'){
    db.prepare("UPDATE withdrawals SET status='approved' WHERE id=?").run(w.id);
    db.prepare('UPDATE users SET total_withdrawn=total_withdrawn+? WHERE id=?').run(w.amount, w.user_id);
    db.prepare("UPDATE transactions SET status='Approved' WHERE user_id=? AND type='Withdrawal' AND amount=? ORDER BY id DESC LIMIT 1").run(w.user_id, -w.amount);
  } else {
    db.prepare("UPDATE withdrawals SET status='rejected' WHERE id=?").run(w.id);
    db.prepare('UPDATE users SET earning_balance=earning_balance+? WHERE id=?').run(w.amount, w.user_id);
    db.prepare("UPDATE transactions SET status='Rejected' WHERE user_id=? AND type='Withdrawal' AND amount=? ORDER BY id DESC LIMIT 1").run(w.user_id, -w.amount);
  }
  res.json({message:'Done'});
});

app.get('/api/admin/users', auth, adminOnly, (req,res)=>{
  const users = db.prepare('SELECT id,name,email,username,earning_balance,ad_balance,total_withdrawn,role,created_at FROM users ORDER BY id DESC').all();
  res.json(users);
});

app.listen(3000, ()=> console.log('TaskAll backend running on port 3000 - Admin: markobinna120@gmail.com'));
