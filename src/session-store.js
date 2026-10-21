import session from 'express-session';
import { sessions } from './db.js';
export class LocalSessionStore extends session.Store {
  get(sid, callback) { try { callback(null, sessions.get(sid)); } catch (e) { callback(e); } }
  set(sid, value, callback = () => {}) { sessions.set(sid, value).then(() => callback(), callback); }
  destroy(sid, callback = () => {}) { sessions.destroy(sid).then(() => callback(), callback); }
  touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
}
