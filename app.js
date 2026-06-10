/* ============================================
   صيدلية الأمين الحديثة - منطق التطبيق
   مع مزامنة Firebase Realtime
   ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, off, remove, serverTimestamp, onDisconnect, get, child }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile, GoogleAuthProvider,
  signInWithPopup, RecaptchaVerifier, signInWithPhoneNumber }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig as rawConfig, DEFAULT_PHARMACY_CODE, PHARMACY_NAME,
  DEFAULT_CATEGORIES, DEFAULT_COMPANIES, ALERT_CONFIG, PRIORITIES, SHORTAGE_REASONS,
  CHRONIC_CONDITIONS, PATIENT_CONFIG, BACKUP_CONFIG } from "./firebase-config.js";

// بناء databaseURL تلقائياً إذا لم تكن موجودة في الإعدادات
const firebaseConfig = {
  ...rawConfig,
  databaseURL: rawConfig.databaseURL ||
    `https://${rawConfig.projectId}-default-rtdb.firebaseio.com`,
};

let db = null;
let dbRef = null;
let currentCode = null;
let currentUser = null;     // ⚡ المستخدم الحالي (Firebase Auth)
let currentUserId = null;   // ⚡ معرف المستخدم
let deviceId = null;

// ============================================
// الثوابت
// ============================================
const PHARMACY = {
  name: PHARMACY_NAME,
  whatsapp: '967774973636',
  phone: '+967774973636',
  email: 'alaminmodern.ph@gmail.com',
  address: 'اليمن - إب - مدينة القاعدة',
  facebook: 'https://www.facebook.com/share/18BNE6VzVK/',
};

// ============================================
// أدوات مساعدة
// ============================================
const $ = (sel, parent = document) => parent.querySelector(sel);
const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// تطبيع الكود (إزالة المسافات وتوحيد حالة الأحرف)
function normalizeCode(code) {
  return code.trim().toLowerCase().replace(/\s+/g, '-');
}

// تجزئة الكود لاستخدامه كمسار آمن في Firebase
// (يحل محل أي محارف غير آمنة)
function codeToPath(code) {
  return code.replace(/[^a-z0-9\-_]/gi, '_');
}

// ============================================
// إدارة الجهاز
// ============================================
function getDeviceId() {
  if (deviceId) return deviceId;
  const KEY = 'alamin_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev_' + uid() + uid();
    localStorage.setItem(KEY, id);
  }
  deviceId = id;
  return id;
}

function getSavedCode() {
  return localStorage.getItem('alamin_pharmacy_code');
}

function saveCode(code) {
  localStorage.setItem('alamin_pharmacy_code', code);
}

function clearCode() {
  localStorage.removeItem('alamin_pharmacy_code');
}

// ============================================
// شريط حالة المزامنة
// ============================================
function setSyncState(state, text) {
  const dot = $('#sync-dot');
  const textEl = $('#sync-text');
  dot.className = 'sync-dot';
  if (state === 'syncing')   dot.classList.add('sync-dot--syncing');
  if (state === 'offline')   dot.classList.add('sync-dot--offline');
  if (state === 'connecting') dot.classList.add('sync-dot--connecting');
  if (text) textEl.textContent = text;
}

function setSyncPharmacy(code) {
  $('#sync-pharmacy').textContent = code;
}

// ============================================
// شاشة تسجيل الدخول
// ============================================
function setupAuth() {
  // ⚡ تهيئة Firebase Auth
  const authApp = initializeApp(firebaseConfig, 'alamin-auth');
  const auth = getAuth(authApp);
  // ⚡ ضبط اللغة العربية للـ Firebase Auth
  auth.languageCode = 'ar';

  // ⚡ التحقق من حالة المستخدم (مسجّل دخول سابقاً؟)
  onAuthStateChanged(auth, (user) => {
    if (user && !currentUser) {
      console.log('✅ مستخدم مسجّل:', user.email);
      setSyncState('connecting', 'جاري تحميل البيانات...');
      try {
        connectToUserAccount(user);
      } catch (e) {
        console.error(e);
        showAuthError('login', 'فشل تحميل البيانات: ' + e.message);
      }
    }
  });

  // ⚡ تبويبات تسجيل الدخول
  $$('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      $$('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.auth-form').forEach(f => f.classList.add('hidden'));
      const target = tab.dataset.authTab;
      if (target === 'login') $('#auth-login').classList.remove('hidden');
      if (target === 'register') $('#auth-register').classList.remove('hidden');
      if (target === 'code') $('#auth-code').classList.remove('hidden');
    };
  });

  // ⚡ تسجيل الدخول بالإيميل + كلمة السر
  $('#auth-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    if (!email || !password) return;
    setAuthLoading('login', true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // سيتم التعامل معه في onAuthStateChanged
      console.log('✅ تم تسجيل الدخول:', cred.user.email);
    } catch (err) {
      console.error('Login error:', err);
      let msg = 'فشل تسجيل الدخول';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password')
        msg = '❌ البريد أو كلمة السر غير صحيحة';
      else if (err.code === 'auth/user-not-found')
        msg = '❌ لا يوجد حساب بهذا البريد. أنشئ حساب جديد.';
      else if (err.code === 'auth/too-many-requests')
        msg = '⏳ محاولات كثيرة. حاول بعد قليل.';
      else if (err.code === 'auth/network-request-failed')
        msg = '📡 تعذر الاتصال بالإنترنت';
      showAuthError('login', msg);
    } finally {
      setAuthLoading('login', false);
    }
  });

  // ⚡ إنشاء حساب جديد
  $('#auth-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#reg-name').value.trim();
    const email = $('#reg-email').value.trim();
    const pw = $('#reg-password').value;
    const pw2 = $('#reg-password2').value;
    if (!name || !email || !pw) return;
    if (pw.length < 6) {
      showAuthError('reg', '❌ كلمة السر يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (pw !== pw2) {
      showAuthError('reg', '❌ كلمتا السر غير متطابقتين');
      return;
    }
    setAuthLoading('register', true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await updateProfile(cred.user, { displayName: name });
      console.log('✅ تم إنشاء الحساب:', cred.user.email);
      toast(`أهلاً ${name}! 🎉 تم إنشاء حسابك بنجاح`);
    } catch (err) {
      console.error('Register error:', err);
      let msg = 'فشل إنشاء الحساب';
      if (err.code === 'auth/email-already-in-use')
        msg = '❌ هذا البريد مسجّل مسبقاً. جرّب تسجيل الدخول.';
      else if (err.code === 'auth/invalid-email')
        msg = '❌ البريد الإلكتروني غير صالح';
      else if (err.code === 'auth/weak-password')
        msg = '❌ كلمة السر ضعيفة';
      showAuthError('reg', msg);
    } finally {
      setAuthLoading('register', false);
    }
  });

  // ⚡ نسيت كلمة السر
  $('#forgot-password').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!email) {
      showAuthError('login', '📧 أدخل بريدك أولاً ثم اضغط "نسيت كلمة السر"');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      toast('✅ تم إرسال رابط إعادة التعيين إلى بريدك');
    } catch (err) {
      showAuthError('login', 'فشل: ' + (err.message || err.code));
    }
  });

  // ⚡ الكود السريع (الطريقة القديمة)
  $('#auth-code').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#pharmacy-code').value.trim();
    if (!code) {
      showAuthError('code', 'أدخل الكود السري');
      return;
    }
    setAuthLoading('code', true);
    try {
      const normalized = normalizeCode(code);
      saveCode(normalized);
      connectToDatabase(normalized);
    } catch (err) {
      showAuthError('code', 'تعذر الاتصال: ' + err.message);
      setAuthLoading('code', false);
    }
  });
}

function setAuthLoading(which, loading) {
  const form = $('#auth-' + which);
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.orig = btn.textContent;
    btn.textContent = '⏳ جاري...';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.orig || btn.textContent;
  }
}

function showAuthError(which, msg) {
  const el = $('#' + which + '-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

// ============================================
// الاتصال بـ Firebase
// ============================================
function connectToDatabase(code) {
  currentCode = code;
  const path = codeToPath(code);

  // تهيئة Firebase
  const app = initializeApp(firebaseConfig, 'alamin-' + path);
  db = getDatabase(app);
  dbRef = ref(db, 'pharmacies/' + path);

  // الاستماع للبيانات
  onValue(dbRef, (snapshot) => {
    const data = snapshot.val() || { shortages: {}, expiring: {}, patients: {}, log: {} };
    const shortages = Object.values(data.shortages || {});
    const expiring = Object.values(data.expiring || {});
    const patients = Object.values(data.patients || {});
    const log = Object.values(data.log || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // ⚡ تحسين الأداء: تحقّق هل البيانات تغيّرت فعلاً
    const newSig = JSON.stringify({ s: shortages.length, e: expiring.length, p: patients.length, l: log.length });
    if (newSig === state._lastSig) {
      setSyncState('online', 'متزامن ✓');
      return;
    }
    state._lastSig = newSig;

    state.shortages = shortages;
    state.expiring = expiring;
    state.patients = patients;
    state.log = log;

    // ⚡ Throttle: تجميع الإعداءات لتجنّب تجميد الواجهة
    if (state._renderTimer) clearTimeout(state._renderTimer);
    state._renderTimer = setTimeout(() => {
      renderShortages();
      renderExpiring();
      renderPatients();
      renderAlerts();
      renderLog();
      updatePatientBadge();
    }, 50);

    setSyncState('online', 'متزامن ✓');

    // ⚡ تحديث حالة المزامنة في تبويب النسخ
    updateBackupStatus();

    // إخفاء شاشة الدخول وإظهار التطبيق
    $('#auth-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    setSyncPharmacy(currentCode);

    // حفظ الكود محلياً
    saveCode(code);

    // تسجيل الجهاز النشط
    registerPresence(path);
  }, (error) => {
    console.error('Firebase error:', error);
    setSyncState('offline', 'غير متصل');
    const errMsg = $('#code-error');
    if (errMsg) {
      errMsg.textContent = 'فشل الاتصال: ' + (error.message || 'تحقق من الإنترنت');
      errMsg.classList.remove('hidden');
    }
  });
}

// ⚡ الاتصال بحساب المستخدم (Firebase Auth)
function connectToUserAccount(user) {
  currentUser = user;
  currentUserId = user.uid;

  // ⚡ بيانات كل مستخدم محفوظة في مسار خاص به
  const userPath = `users/${user.uid}`;
  const app = initializeApp(firebaseConfig, 'alamin-user-' + user.uid);
  db = getDatabase(app);
  dbRef = ref(db, userPath);
  currentCode = user.email; // عرض الإيميل في الواجهة

  // الاستماع للبيانات
  onValue(dbRef, (snapshot) => {
    const data = snapshot.val() || { shortages: {}, expiring: {}, patients: {}, log: {}, backups: {}, meta: {} };
    const shortages = Object.values(data.shortages || {});
    const expiring = Object.values(data.expiring || {});
    const patients = Object.values(data.patients || {});
    const log = Object.values(data.log || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const backups = Object.values(data.backups || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const newSig = JSON.stringify({ s: shortages.length, e: expiring.length, p: patients.length, l: log.length });
    if (newSig === state._lastSig) {
      setSyncState('online', 'متزامن ✓');
      return;
    }
    state._lastSig = newSig;

    state.shortages = shortages;
    state.expiring = expiring;
    state.patients = patients;
    state.log = log;
    state.backups = backups;
    state.lastCloudSync = data.meta?.lastCloudSync || null;

    if (state._renderTimer) clearTimeout(state._renderTimer);
    state._renderTimer = setTimeout(() => {
      renderShortages();
      renderExpiring();
      renderPatients();
      renderAlerts();
      renderLog();
      renderBackups();
      updatePatientBadge();
      updateBackupStatus();
    }, 50);

    setSyncState('online', 'متزامن ✓');
    $('#auth-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    setSyncPharmacy(user.email.split('@')[0]);

    // تسجيل الجهاز
    registerPresence(`users/${user.uid}/presence/${getDeviceId()}`);
    saveUserInfo(user);

    // ⚡ نسخ احتياطي تلقائي عند الدخول لأول مرة
    if (!data.meta?.firstSyncDone) {
      setTimeout(() => performAutoBackup('welcome'), 2000);
    }
  }, (error) => {
    console.error('Firebase user error:', error);
    setSyncState('offline', 'غير متصل');
  });
}

function saveUserInfo(user) {
  localStorage.setItem('alamin_user_email', user.email);
  localStorage.setItem('alamin_user_name', user.displayName || user.email.split('@')[0]);
  localStorage.setItem('alamin_user_uid', user.uid);
}

function getSavedUser() {
  return {
    email: localStorage.getItem('alamin_user_email'),
    uid: localStorage.getItem('alamin_user_uid'),
    name: localStorage.getItem('alamin_user_name'),
  };
}

function clearUser() {
  localStorage.removeItem('alamin_user_email');
  localStorage.removeItem('alamin_user_uid');
  localStorage.removeItem('alamin_user_name');
  localStorage.removeItem('alamin_pharmacy_code');
}

// ============================================
// تتبع الأجهزة المتصلة
// ============================================
function registerPresence(path) {
  const myId = getDeviceId();
  const presenceRef = ref(db, `pharmacies/${path}/presence/${myId}`);
  const meta = {
    online: true,
    lastSeen: serverTimestamp(),
    ua: navigator.userAgent.slice(0, 100),
  };

  set(presenceRef, meta);
  onDisconnect(presenceRef).remove();

  // تحديث دوري
  setInterval(() => {
    if (currentCode) {
      set(ref(db, `pharmacies/${path}/presence/${myId}/lastSeen`), serverTimestamp());
    }
  }, 30000);
}

// ============================================
// الحالة
// ============================================
let state = {
  shortages: [],
  expiring: [],
  patients: [],
  log: [],
  backups: [],
  lastCloudSync: null,
  dismissedAlerts: [],
  _lastSig: '',
  _renderTimer: null,
  _itemCache: new Map(),
};

let filters = {
  shortagesSearch: '',
  shortagesCategory: '',
  shortagesPriority: '',
  patientsSearch: '',
  patientsCondition: '',
};

// حاوية مؤقتة لأدوية المريض أثناء الإضافة/التعديل
let _patientMeds = [];

// ================ السجل ================
// ⚡ تحسين: تجميع السجلات (Batch) لتجنّب 5 تحديثات متتالية من Firebase
let _logQueue = [];
let _logFlushTimer = null;

async function logAction(action, details) {
  const entry = {
    id: uid(),
    action,
    type: details.type || '',
    name: details.name || '',
    summary: details.summary || '',
    deviceId: getDeviceId().slice(0, 8),
    timestamp: Date.now(),
  };
  state.log.unshift(entry);
  if (state.log.length > 200) state.log = state.log.slice(0, 200);

  // إضافة للقائمة المجمّعة
  _logQueue.push(entry);

  // تجميع الكتابة كل 500ms (Debounce)
  if (_logFlushTimer) clearTimeout(_logFlushTimer);
  _logFlushTimer = setTimeout(flushLog, 500);

  // تحديث السجل محلياً فوراً
  if (state._renderTimer) clearTimeout(state._renderTimer);
  state._renderTimer = setTimeout(() => {
    renderLog();
  }, 100);
}

async function flushLog() {
  if (!_logQueue.length || !dbRef) return;
  const batch = _logQueue.slice();
  _logQueue = [];
  try {
    const updates = {};
    batch.forEach(entry => {
      updates[`log/${entry.id}`] = entry;
    });
    // ⚡ تحديث سجل فقط (لا نستبدل كل البيانات)
    await set(ref(db, `pharmacies/${codeToPath(currentCode)}/log`), updates);
  } catch (e) {
    console.warn('فشل تسجيل العمليات:', e);
  }
}

function renderLog() {
  const list = $('#log-list');
  if (!list) return;
  if (!state.log.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">📜</div>
        <p>لا توجد عمليات مسجلة بعد. ستظهر هنا جميع الإضافات والتعديلات.</p>
      </div>`;
    return;
  }
  // ⚡ عرض آخر 30 عملية فقط (مع زر "تحميل المزيد" إذا لزم)
  const displayed = state.log.slice(0, 30);
  const actionMap = {
    add:    { icon: '➕', label: 'إضافة', class: 'log-item--add' },
    edit:   { icon: '✏️', label: 'تعديل', class: 'log-item--edit' },
    delete: { icon: '🗑️', label: 'حذف', class: 'log-item--delete' },
    system: { icon: '⚙️', label: 'نظام', class: 'log-item--system' },
  };
  let html = displayed.map((e) => {
    const meta = actionMap[e.action] || actionMap.system;
    const time = new Date(e.timestamp).toLocaleString('ar-EG', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    return `
      <div class="log-item ${meta.class}">
        <div class="log-item__icon">${meta.icon}</div>
        <div class="log-item__body">
          <div class="log-item__action">${escapeHtml(meta.label)}: ${escapeHtml(e.summary || e.name)}</div>
          <div class="log-item__meta">
            <span>📅 ${time}</span>
            <span>📱 جهاز ${e.deviceId}</span>
            ${e.type ? `<span>• ${e.type === 'shortage' ? 'نواقص' : e.type === 'expiring' ? 'صلاحيات' : ''}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  if (state.log.length > 30) {
    html += `<button id="load-more-log" class="btn btn--ghost btn--block" style="margin-top:12px">تحميل ${state.log.length - 30} عملية سابقة...</button>`;
  }
  list.innerHTML = html;

  const loadMore = $('#load-more-log');
  if (loadMore) {
    loadMore.onclick = () => {
      const displayedAll = state.log.slice(0, 100);
      list.innerHTML = displayedAll.map((e) => {
        const meta = actionMap[e.action] || actionMap.system;
        const time = new Date(e.timestamp).toLocaleString('ar-EG', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        return `
        <div class="log-item ${meta.class}">
          <div class="log-item__icon">${meta.icon}</div>
          <div class="log-item__body">
            <div class="log-item__action">${escapeHtml(meta.label)}: ${escapeHtml(e.summary || e.name)}</div>
            <div class="log-item__meta">
              <span>📅 ${time}</span>
              <span>📱 جهاز ${e.deviceId}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    };
  }
}

// ================ التنبيهات الذكية ================
function getAlerts() {
  const alerts = [];
  const now = Date.now();

  // تنبيهات المرضى المتأخرين والقريبين
  alerts.push(...getPatientAlerts());

  // تنبيهات الحد الأدنى (النواقص التي وصلت لحد التنبيه)
  state.shortages.forEach((it) => {
    if (it.minStock && it.currentStock != null && it.currentStock <= it.minStock) {
      alerts.push({
        id: 'low-' + it.id,
        kind: it.currentStock === 0 ? 'urgent' : 'warning',
        icon: it.currentStock === 0 ? '🚨' : '⚠️',
        title: it.currentStock === 0
          ? `نفد المخزون: ${it.name}`
          : `مخزون منخفض: ${it.name}`,
        sub: `الكمية الحالية: ${it.currentStock} | الحد الأدنى: ${it.minStock}`,
        action: 'طلب',
        targetItem: it,
      });
    }
  });

  // تنبيهات قرب الانتهاء
  state.expiring.forEach((it) => {
    const days = daysUntil(it.expiryDate);
    if (days == null) return;
    if (days < 0) {
      alerts.push({
        id: 'exp-' + it.id,
        kind: 'urgent',
        icon: '💀',
        title: `منتهي الصلاحية: ${it.name}`,
        sub: `انتهت منذ ${Math.abs(days)} يوم — يُنصح بالتصفية الفورية`,
        action: 'تصفية',
        targetItem: it,
      });
    } else if (days <= 30) {
      alerts.push({
        id: 'exp-' + it.id,
        kind: 'urgent',
        icon: '⏰',
        title: `أقل من شهر: ${it.name}`,
        sub: `متبقي ${days} يوم فقط — يحتاج اهتمام فوري`,
        action: 'تصفية',
        targetItem: it,
      });
    } else if (days <= 90) {
      alerts.push({
        id: 'exp-' + it.id,
        kind: 'warning',
        icon: '📅',
        title: `أقل من 3 أشهر: ${it.name}`,
        sub: `متبقي ${days} يوم — يفضل التخطيط للعرض أو التحويل`,
        action: 'تصفية',
        targetItem: it,
      });
    } else if (days <= 180) {
      alerts.push({
        id: 'exp-' + it.id,
        kind: 'info',
        icon: '📆',
        title: `أقل من 6 أشهر: ${it.name}`,
        sub: `متبقي ${days} يوم — راقب المخزون`,
        action: 'تصفية',
        targetItem: it,
      });
    }
  });

  return alerts.filter(a => !state.dismissedAlerts.includes(a.id));
}

function renderAlerts() {
  const list = $('#alerts-list');
  const badge = $('#badge-alerts');
  if (!list) return;
  const alerts = getAlerts();
  if (badge) {
    if (alerts.length > 0) {
      badge.hidden = false;
      badge.textContent = alerts.length;
    } else {
      badge.hidden = true;
    }
  }

  if (!alerts.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">✅</div>
        <p><strong>كل شيء على ما يرام!</strong><br>لا توجد تنبيهات حالياً.</p>
      </div>`;
    return;
  }

  // ⚡ عرض أول 20 تنبيه فقط
  const displayed = alerts.slice(0, 20);
  list.innerHTML = displayed.map(a => `
    <div class="alert alert--${a.kind}" data-alert-id="${a.id}">
      <div class="alert__icon">${a.icon}</div>
      <div class="alert__body">
        <p class="alert__title">${escapeHtml(a.title)}</p>
        <p class="alert__sub">${escapeHtml(a.sub)}</p>
      </div>
      <div class="alert__actions">
        ${a.action ? `<button class="btn btn--sm btn--primary" data-alert-action>${a.action}</button>` : ''}
        <button class="icon-btn" data-alert-dismiss aria-label="إخفاء">✕</button>
      </div>
    </div>
  `).join('');
  if (alerts.length > 20) {
    list.innerHTML += `<p style="text-align:center;color:var(--text-soft);font-size:12px;padding:8px">+ ${alerts.length - 20} تنبيه آخر</p>`;
  }
}

function setupAlerts() {
  const list = $('#alerts-list');
  if (!list) return;

  list.addEventListener('click', async (e) => {
    const alert = e.target.closest('.alert');
    if (!alert) return;
    const id = alert.dataset.alertId;
    const a = getAlerts().find(x => x.id === id);
    if (!a) return;

    if (e.target.closest('[data-alert-dismiss]')) {
      state.dismissedAlerts.push(id);
      renderAlerts();
      return;
    }
    if (e.target.closest('[data-alert-action]')) {
      if (a.action === 'طلب') {
        $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'shortages'));
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-shortages'));
      } else if (a.action === 'تصفية') {
        const it = a.targetItem;
        const msg = `💊 *صيدلية الأمين الحديثة*\n🔥 *عرض تصفية*\n\nالصنف: ${it.name}${it.batch ? ` (دفعة: ${it.batch})` : ''}\nالكمية: ${it.quantity || 1}\nانتهاء: ${formatDate(it.expiryDate)}\n\nللحجز والاستفسار:\n📞 ${PHARMACY.phone}`;
        const url = `https://wa.me/${PHARMACY.whatsapp}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
      } else if (a.action === 'تذكير' && a.targetItem && a.targetItem.phone) {
        // إرسال تذكير واتساب للمريض
        const p = a.targetItem;
        const days = daysToNextDispense(p);
        const phone = phoneToWhatsApp(p.phone);
        const msg = `السلام عليكم ${p.name}،\n${days < 0 ? 'نذكركم بأن موعد صرف أدويتكم قد حان منذ ' + Math.abs(days) + ' يوم.' : 'أدويتكم الشهرية ستكون جاهزة بعد ' + days + ' يوم.'}\n\nصيدلية الأمين الحديثة\n📞 ${PHARMACY.phone}`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        toast('✅ تم فتح واتساب لإرسال التذكير');
      } else if (a.action === 'صرف' && a.targetItem) {
        $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'patients'));
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-patients'));
      }
    }
  });

  $('#dismiss-all-alerts').addEventListener('click', () => {
    getAlerts().forEach(a => state.dismissedAlerts.push(a.id));
    renderAlerts();
    toast('تم إخفاء جميع التنبيهات');
  });
}

function setupLog() {
  $('#clear-log').addEventListener('click', async () => {
    if (!state.log.length) return;
    const ok = await confirmDialog({
      title: 'مسح السجل',
      message: `سيتم حذف ${state.log.length} عملية من السجل. هل أنت متأكد؟`,
    });
    if (!ok) return;
    state.log = [];
    try {
      await set(ref(db, `pharmacies/${codeToPath(currentCode)}/log`), null);
    } catch (e) {}
    renderLog();
    toast('تم مسح السجل');
  });
}

// ============================================
// أدوات مساعدة للواجهة
// ============================================
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function confirmDialog({ title = 'تأكيد', message = 'هل أنت متأكد؟', okText = 'نعم', danger = true } = {}) {
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    const okBtn = $('#confirm-ok');
    okBtn.textContent = okText;
    okBtn.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      okBtn.onclick = null;
      $('#confirm-cancel').onclick = null;
      $('.modal__backdrop', modal).onclick = null;
    };
    okBtn.onclick = () => { cleanup(); resolve(true); };
    $('#confirm-cancel').onclick = () => { cleanup(); resolve(false); };
    $('.modal__backdrop', modal).onclick = () => { cleanup(); resolve(false); };
  });
}

// ============================================
// كتابة البيانات إلى Firebase
// ============================================
async function pushItem(kind, item) {
  if (!dbRef) return;
  setSyncState('syncing', 'جاري الحفظ...');
  try {
    // ⚡ تحديث عنصر واحد فقط بدلاً من استبدال الكل
    const itemRef = ref(db, `pharmacies/${codeToPath(currentCode)}/${kind}/${item.id}`);
    await set(itemRef, item);
    setSyncState('online', 'متزامن ✓');
  } catch (e) {
    setSyncState('offline', 'فشل الحفظ');
    toast('فشل الحفظ: ' + e.message);
  }
}

async function removeItem(kind, id) {
  if (!dbRef) return;
  setSyncState('syncing', 'جاري الحذف...');
  try {
    const itemRef = ref(db, `pharmacies/${codeToPath(currentCode)}/${kind}/${id}`);
    await remove(itemRef);
    setSyncState('online', 'متزامن ✓');
  } catch (e) {
    setSyncState('offline', 'فشل الحذف');
    toast('فشل الحذف: ' + e.message);
  }
}

async function clearKind(kind) {
  if (!dbRef) return;
  setSyncState('syncing', 'جاري المسح...');
  try {
    const kindRef = ref(db, `pharmacies/${codeToPath(currentCode)}/${kind}`);
    await remove(kindRef);
    setSyncState('online', 'متزامن ✓');
  } catch (e) {
    setSyncState('offline', 'فشل المسح');
    toast('فشل المسح: ' + e.message);
  }
}

// ============================================
// المرضى المزمنين
// ============================================

// حساب تاريخ الصرف القادم
function nextDispenseDate(patient) {
  if (!patient.lastDispense) return patient.startDate ? new Date(patient.startDate).getTime() : Date.now();
  const last = new Date(patient.lastDispense);
  const cycle = patient.cycleDays || PATIENT_CONFIG.defaultCycleDays;
  const next = new Date(last);
  next.setDate(next.getDate() + cycle);
  return next.getTime();
}

// حساب الأيام المتبقية للصرف القادم
function daysToNextDispense(patient) {
  const next = nextDispenseDate(patient);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextDate = new Date(next);
  nextDate.setHours(0, 0, 0, 0);
  return Math.round((nextDate - today) / (1000 * 60 * 60 * 24));
}

// تنسيق رقم هاتف للواتساب (يبدأ بـ 967)
function phoneToWhatsApp(phone) {
  if (!phone) return '';
  // إزالة كل ما عدا الأرقام والـ +
  let p = phone.replace(/[^\d+]/g, '');
  // إذا يبدأ بـ 0، أبدله بكود اليمن 967
  if (p.startsWith('0')) p = '967' + p.slice(1);
  if (p.startsWith('+')) p = p.slice(1);
  if (!p.startsWith('967') && p.length === 9) p = '967' + p;
  return p;
}

// عدد الأشهر المتتالية للشراء
function consecutiveMonths(patient) {
  if (!patient.dispenseHistory || patient.dispenseHistory.length < 2) return 1;
  const sorted = patient.dispenseHistory.slice().sort((a, b) => b.date - a.date);
  let months = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (sorted[i - 1].date - sorted[i].date) / (1000 * 60 * 60 * 24);
    if (diff <= 35) months++;
    else break;
  }
  return months;
}

// إجمالي نقاط الولاء
function loyaltyPoints(patient) {
  return Math.floor((patient.totalSpent || 0) * PATIENT_CONFIG.loyaltyPointPerRiyal);
}

function patientClass(patient) {
  const days = daysToNextDispense(patient);
  if (days < 0) return 'patient-card--overdue';
  const reminderDays = patient.reminderDays || 5;
  if (days <= reminderDays) return 'patient-card--due';
  if (consecutiveMonths(patient) >= PATIENT_CONFIG.vipThreshold) return 'patient-card--vip';
  return '';
}

function renderPatients() {
  const list = $('#patients-list');
  const actions = $('#patients-actions');
  const badge = $('#badge-patients');
  if (!list) return;

  let items = state.patients.slice();

  // فلترة
  if (filters.patientsSearch) {
    const q = filters.patientsSearch.toLowerCase();
    items = items.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.phone || '').includes(q) ||
      (p.address || '').toLowerCase().includes(q)
    );
  }
  if (filters.patientsCondition) {
    items = items.filter(p =>
      (p.conditions || []).includes(filters.patientsCondition) ||
      p.customCondition === filters.patientsCondition
    );
  }

  // ملء فلتر الأمراض
  const condFilter = $('#filter-patients-cond');
  if (condFilter) {
    const currentVal = condFilter.value;
    const allConds = new Set();
    state.patients.forEach(p => {
      (p.conditions || []).forEach(c => allConds.add(c));
      if (p.customCondition) allConds.add(p.customCondition);
    });
    condFilter.innerHTML = '<option value="">كل الأمراض</option>' +
      CHRONIC_CONDITIONS.filter(c => allConds.has(c.key))
        .map(c => `<option value="${c.key}">${c.emoji} ${c.label}</option>`).join('') +
      [...allConds].filter(k => !CHRONIC_CONDITIONS.find(c => c.key === k))
        .map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
    condFilter.value = currentVal;
  }

  if (!state.patients.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">💊</div>
        <p>لا يوجد مرضى مسجلين. ابدأ بإضافة مريض جديد.</p>
      </div>`;
    actions.classList.add('hidden');
    if (badge) badge.hidden = true;
    return;
  }

  if (!items.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">🔍</div>
        <p>لا توجد نتائج تطابق البحث/الفلتر.</p>
      </div>`;
    actions.classList.remove('hidden');
    return;
  }

  actions.classList.remove('hidden');

  // ترتيب: المتأخرين أولاً، ثم القريبين، ثم الباقين
  items.sort((a, b) => {
    const da = daysToNextDispense(a);
    const db = daysToNextDispense(b);
    if (da < 0 && db >= 0) return -1;
    if (db < 0 && da >= 0) return 1;
    return da - db;
  });

  list.innerHTML = items.map(p => {
    const days = daysToNextDispense(p);
    const conditions = (p.conditions || []).map(k => {
      const c = CHRONIC_CONDITIONS.find(x => x.key === k);
      return c ? `<span class="patient-card__condition" style="background:${c.color}22;color:${c.color}">${c.emoji} ${c.label}</span>` : '';
    }).join('');
    const customC = p.customCondition ? `<span class="patient-card__condition">${escapeHtml(p.customCondition)}</span>` : '';
    const meds = (p.medications || []).slice(0, 3).map(m =>
      `<strong>${escapeHtml(m.name)}</strong>${m.dosage ? ` (${escapeHtml(m.dosage)})` : ''}${m.qty ? ` × ${escapeHtml(m.qty)}` : ''}`
    ).join(' • ');
    const moreMeds = (p.medications || []).length > 3 ? ` <em>+${p.medications.length - 3}</em>` : '';
    const months = consecutiveMonths(p);
    const isVip = months >= PATIENT_CONFIG.vipThreshold;
    const points = loyaltyPoints(p);

    let cycleText = '';
    let cycleClass = '';
    if (days < 0) {
      cycleText = `⛔ متأخر ${Math.abs(days)} يوم`;
      cycleClass = 'patient-card__cycle--overdue';
    } else if (days === 0) {
      cycleText = '🔔 موعد اليوم!';
      cycleClass = 'patient-card__cycle--due';
    } else if (days <= (p.reminderDays || 5)) {
      cycleText = `⏰ يتبقى ${days} يوم`;
      cycleClass = 'patient-card__cycle--due';
    } else {
      cycleText = `📅 بعد ${days} يوم`;
    }

    return `
      <div class="patient-card ${patientClass(p)}" data-id="${p.id}">
        <div class="patient-card__header">
          <div>
            <h3 class="patient-card__name">
              ${escapeHtml(p.name)}
              ${isVip ? '<span class="patient-card__vip">⭐ VIP</span>' : ''}
            </h3>
            <div class="patient-card__phone">📞 ${escapeHtml(p.phone)}</div>
          </div>
          <div class="patient-card__actions">
            <a class="btn-pill btn-pill--whatsapp" data-wa-remind href="#" title="تذكير واتساب">📱</a>
            <button class="btn-pill btn-pill--primary" data-dispense title="تسجيل صرف">✅ صرف</button>
            <button class="btn-pill btn-pill--ghost" data-view title="التفاصيل">👁️</button>
            <button class="btn-pill btn-pill--ghost" data-edit title="تعديل">✏️</button>
            <button class="btn-pill btn-pill--ghost" data-delete title="حذف" style="background:#FEE2E2;color:#991B1B">🗑️</button>
          </div>
        </div>
        <div class="patient-card__conditions">${conditions}${customC}</div>
        ${(p.medications && p.medications.length) ? `<div class="patient-card__meds">💊 ${meds}${moreMeds}</div>` : ''}
        <div class="patient-card__footer">
          <div class="patient-card__cycle ${cycleClass}">${cycleText}</div>
          <div style="font-size:11px;color:var(--text-soft);display:flex;gap:8px;align-items:center">
            ${p.totalSpent ? `<span>💰 ${p.totalSpent.toLocaleString('ar-EG')} ر.ي</span>` : ''}
            ${isVip && points ? `<span>⭐ ${points} نقطة</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// تحديث badge المرضى (المتأخرين + القريبين)
function updatePatientBadge() {
  const badge = $('#badge-patients');
  if (!badge) return;
  const urgent = state.patients.filter(p => {
    const d = daysToNextDispense(p);
    return d < 0 || d <= (p.reminderDays || 5);
  }).length;
  if (urgent > 0) {
    badge.hidden = false;
    badge.textContent = urgent;
  } else {
    badge.hidden = true;
  }
}

// ============= نموذج المريض =============
function renderConditionPicker(selected = []) {
  const wrap = $('#conditions-picker');
  if (!wrap) return;
  wrap.innerHTML = CHRONIC_CONDITIONS.map(c => `
    <button type="button" class="condition-chip ${selected.includes(c.key) ? 'active' : ''}" data-cond="${c.key}">
      ${c.emoji} ${c.label}
    </button>
  `).join('');
  $$('.condition-chip', wrap).forEach(btn => {
    btn.onclick = () => btn.classList.toggle('active');
  });
}

function renderMedicationRows(meds = []) {
  _patientMeds = meds.length ? meds.slice() : [{ name: '', dosage: '', qty: '', duration: '' }];
  drawMedicationRows();
}

function drawMedicationRows() {
  const wrap = $('#medications-list');
  if (!wrap) return;
  wrap.innerHTML = _patientMeds.map((m, i) => `
    <div class="medication-row" data-i="${i}">
      <input type="text" placeholder="اسم الدواء" value="${escapeHtml(m.name || '')}" data-m="name" />
      <input type="text" placeholder="الجرعة (مثال: 500mg × 2)" value="${escapeHtml(m.dosage || '')}" data-m="dosage" />
      <input type="text" placeholder="الكمية الشهرية" value="${escapeHtml(m.qty || '')}" data-m="qty" />
      <button type="button" class="icon-btn icon-btn--danger" data-m-del="${i}" title="حذف">✕</button>
    </div>
  `).join('');
  $$('input[data-m]', wrap).forEach(inp => {
    inp.oninput = (e) => {
      const i = +inp.closest('.medication-row').dataset.i;
      _patientMeds[i][inp.dataset.m] = e.target.value;
    };
  });
  $$('button[data-m-del]', wrap).forEach(btn => {
    btn.onclick = () => {
      _patientMeds.splice(+btn.dataset.mDel, 1);
      if (!_patientMeds.length) _patientMeds.push({ name: '', dosage: '', qty: '', duration: '' });
      drawMedicationRows();
    };
  });
}

function setupPatients() {
  const form = $('#form-patient');
  const wrap = form;
  let editingId = null;

  // ⚡ دالة موحّدة لفتح/إغلاق النموذج
  function showForm(show, title = 'إضافة مريض جديد') {
    if (show) {
      $('.form__title', wrap).textContent = title;
      wrap.classList.remove('hidden');
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => $('input[name="name"]', wrap).focus(), 200);
    } else {
      wrap.classList.add('hidden');
    }
  }

  function resetForm() {
    form.reset();
    _patientMeds = [];
    editingId = null;
    renderMedicationRows();
    renderConditionPicker();
  }

  $('#add-patient').addEventListener('click', () => {
    resetForm();
    showForm(true, 'إضافة مريض جديد');
  });

  $('[data-cancel]', wrap).addEventListener('click', () => {
    resetForm();
    showForm(false);
  });

  $('#add-medication').addEventListener('click', () => {
    _patientMeds.push({ name: '', dosage: '', qty: '', duration: '' });
    drawMedicationRows();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    const phone = (fd.get('phone') || '').toString().trim();
    if (!name || !phone) {
      toast('الاسم ورقم الهاتف مطلوبان');
      return;
    }

    const conditions = $$('.condition-chip.active', wrap).map(b => b.dataset.cond);
    const meds = _patientMeds.filter(m => (m.name || '').trim());

    const payload = {
      name,
      phone,
      age: fd.get('age') ? Number(fd.get('age')) : null,
      address: (fd.get('address') || '').toString().trim(),
      notes: (fd.get('notes') || '').toString().trim(),
      conditions,
      customCondition: (fd.get('customCondition') || '').toString().trim(),
      medications: meds,
      reminderDays: Number(fd.get('reminderDays')) || 5,
      cycleDays: Number(fd.get('cycleDays')) || 30,
    };

    if (editingId) {
      // ⚡ وضع التعديل: نحدّث العنصر الموجود
      const existing = state.patients.find(x => x.id === editingId);
      if (existing) {
        const updated = { ...existing, ...payload, updatedAt: Date.now() };
        await pushItem('patients', updated);
        await logAction('edit', { type: 'patient', name, summary: `تعديل بيانات المريض "${name}"` });
        toast('تم تعديل بيانات المريض ✅ ومزامنته');
      } else {
        toast('⚠️ لم يتم العثور على المريض، حاول مرة أخرى');
      }
    } else {
      // وضع الإضافة
      const item = {
        id: uid(),
        ...payload,
        lastDispense: null,
        dispenseHistory: [],
        totalSpent: 0,
        loyaltyPoints: 0,
        createdAt: Date.now(),
        by: getDeviceId().slice(0, 8),
      };
      await pushItem('patients', item);
      await logAction('add', { type: 'patient', name, summary: `إضافة مريض "${name}" (${conditions.length ? (CHRONIC_CONDITIONS.find(c => c.key === conditions[0])?.label || '') : 'بدون حالة'})` });
      toast(`تمت إضافة ${name} ✅ ومزامنته`);
    }

    resetForm();
    showForm(false);
  });

  // أزرار بطاقات المرضى
  $('#patients-list').addEventListener('click', async (e) => {
    const card = e.target.closest('.patient-card');
    if (!card) return;
    const id = card.dataset.id;
    const p = state.patients.find(x => x.id === id);
    if (!p) return;

    // تذكير واتساب
    const waBtn = e.target.closest('[data-wa-remind]');
    if (waBtn) {
      e.preventDefault();
      const phone = phoneToWhatsApp(p.phone);
      const days = daysToNextDispense(p);
      let msg = '';
      if (days < 0) {
        msg = `السلام عليكم ${p.name}،\nنذكركم بأن موعد صرف أدويتكم الشهرية قد حان منذ ${Math.abs(days)} يوم.\nأدويتكم جاهزة للاستلام من صيدلية الأمين الحديثة.\n📞 ${PHARMACY.phone}`;
      } else if (days <= 3) {
        msg = `السلام عليكم ${p.name}،\nنذكركم بأن أدويتكم الشهرية ستكون جاهزة بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}.\nيمكنكم التوجه لصيدلية الأمين الحديثة لاستلامها.\n📞 ${PHARMACY.phone}`;
      } else {
        msg = `السلام عليكم ${p.name}،\nسيحين موعد صرف أدويتكم بعد ${days} يوم.\nنود تأكيد الحجز من فضلكم.\n📞 ${PHARMACY.phone}`;
      }
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
      return;
    }

    // تسجيل صرف
    if (e.target.closest('[data-dispense]')) {
      const ok = await confirmDialog({
        title: 'تسجيل صرف',
        message: `هل تم صرف الأدوية لـ ${p.name} اليوم؟\nسيتم تحديث آخر صرف وحساب نقاط الولاء.`,
        okText: 'نعم، تم الصرف',
        danger: false,
      });
      if (!ok) return;
      const now = Date.now();
      const history = p.dispenseHistory || [];
      // حساب الإنفاق التقريبي (نفترض متوسط 50 ر.ي لكل دواء)
      const orderAmount = (p.medications || []).length * 50;
      const updated = {
        ...p,
        lastDispense: now,
        dispenseHistory: [{ date: now, amount: orderAmount }, ...history].slice(0, 24),
        totalSpent: (p.totalSpent || 0) + orderAmount,
        loyaltyPoints: loyaltyPoints({ ...p, totalSpent: (p.totalSpent || 0) + orderAmount }),
      };
      await pushItem('patients', updated);
      await logAction('system', {
        type: 'patient',
        name: p.name,
        summary: `✅ صرف أدوية "${p.name}" - ${updated.dispenseHistory.length} مرة شراء`,
      });
      toast(`تم تسجيل الصرف ✅ + ${orderAmount} ر.ي إنفاق`);
      return;
    }

    // عرض التفاصيل
    if (e.target.closest('[data-view]')) {
      openPatientDetail(p);
      return;
    }

    // تعديل المريض
    if (e.target.closest('[data-edit]')) {
      e.stopPropagation();
      // ⚡ تعبئة النموذج ببيانات المريض
      editingId = id;
      $('input[name="name"]', wrap).value = p.name || '';
      $('input[name="phone"]', wrap).value = p.phone || '';
      $('input[name="age"]', wrap).value = p.age != null ? p.age : '';
      $('input[name="address"]', wrap).value = p.address || '';
      $('textarea[name="notes"]', wrap).value = p.notes || '';
      $('input[name="customCondition"]', wrap).value = p.customCondition || '';
      $('select[name="reminderDays"]', wrap).value = p.reminderDays || 5;
      $('select[name="cycleDays"]', wrap).value = p.cycleDays || 30;
      // تحديث قائمة الحالات والأدوية
      renderConditionPicker(p.conditions || []);
      renderMedicationRows(p.medications || []);
      // إظهار النموذج
      showForm(true, `تعديل بيانات "${p.name}"`);
      return;
    }

    // حذف
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: 'حذف المريض',
        message: `سيتم حذف "${p.name}" نهائياً مع سجل الصرف. هل أنت متأكد؟`,
      });
      if (!ok) return;
      await removeItem('patients', id);
      await logAction('delete', { type: 'patient', name: p.name, summary: `حذف مريض "${p.name}"` });
      toast('تم الحذف');
    }
  });

  // فلاتر المرضى
  $('#filter-patients').addEventListener('input', (e) => {
    filters.patientsSearch = e.target.value;
    renderPatients();
  });
  $('#filter-patients-cond').addEventListener('change', (e) => {
    filters.patientsCondition = e.target.value;
    renderPatients();
  });

  // تذكير المتأخرين
  $('#share-overdue').addEventListener('click', () => {
    const overdue = state.patients.filter(p => {
      const d = daysToNextDispense(p);
      return d < 0 || d <= (p.reminderDays || 5);
    });
    if (!overdue.length) {
      toast('✅ لا يوجد مرضى بحاجة للتذكير');
      return;
    }
    if (overdue.length === 1) {
      // إرسال لشخص واحد
      const p = overdue[0];
      const phone = phoneToWhatsApp(p.phone);
      const days = daysToNextDispense(p);
      const msg = `السلام عليكم ${p.name}،\n${days < 0 ? 'نذكركم بأن موعد صرف أدويتكم قد حان منذ ' + Math.abs(days) + ' يوم.' : 'أدويتكم الشهرية جاهزة تقريباً بعد ' + days + ' يوم.'}\nأدويتكم جاهزة في صيدلية الأمين الحديثة.\n📞 ${PHARMACY.phone}`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
      return;
    }
    // متعددين: افتح رسالة مجمعة
    const lines = [`💊 *صيدلية الأمين الحديثة*`, `📋 *تذكير جماعي*`, ``];
    overdue.forEach((p, i) => {
      const days = daysToNextDispense(p);
      lines.push(`${i + 1}. ${p.name} (${p.phone}) - ${days < 0 ? '⛔ متأخر ' + Math.abs(days) + ' يوم' : 'بعد ' + days + ' يوم'}`);
    });
    const url = `https://wa.me/${PHARMACY.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank');
  });

  // تصدير
  $('#export-patients').addEventListener('click', () => {
    if (!state.patients.length) {
      toast('لا يوجد مرضى للتصدير');
      return;
    }
    const data = state.patients.map(p => ({
      'الاسم': p.name,
      'الهاتف': p.phone,
      'العمر': p.age || '',
      'العنوان': p.address || '',
      'الحالات المرضية': (p.conditions || []).map(k => CHRONIC_CONDITIONS.find(c => c.key === k)?.label || k).join('، '),
      'الأدوية': (p.medications || []).map(m => `${m.name} (${m.dosage || ''}) × ${m.qty || ''}`).join(' | '),
      'آخر صرف': p.lastDispense ? new Date(p.lastDispense).toLocaleDateString('ar-EG') : 'لم يصرف',
      'إجمالي الإنفاق': p.totalSpent || 0,
      'نقاط الولاء': p.loyaltyPoints || 0,
      'ملاحظات': p.notes || '',
    }));
    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `مرضى_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`تم تصدير ${data.length} مريض ✅`);
  });

  // تهيئة أولية
  renderConditionPicker();
  renderMedicationRows();
}

// ============= تفاصيل المريض =============
function openPatientDetail(p) {
  const modal = $('#patient-modal');
  const content = $('#patient-modal-content');
  const days = daysToNextDispense(p);
  const months = consecutiveMonths(p);
  const isVip = months >= PATIENT_CONFIG.vipThreshold;
  const points = loyaltyPoints(p);
  const progressToVip = Math.min(100, (months / PATIENT_CONFIG.vipThreshold) * 100);

  const conditionsHtml = (p.conditions || []).map(k => {
    const c = CHRONIC_CONDITIONS.find(x => x.key === k);
    return c ? `<span class="patient-card__condition" style="background:${c.color}22;color:${c.color}">${c.emoji} ${c.label}</span>` : '';
  }).join(' ') + (p.customCondition ? `<span class="patient-card__condition">${escapeHtml(p.customCondition)}</span>` : '');

  const medsHtml = (p.medications || []).map(m => `
    <div class="patient-card__meds" style="margin-bottom:4px">
      💊 <strong>${escapeHtml(m.name)}</strong>
      ${m.dosage ? ` • ${escapeHtml(m.dosage)}` : ''}
      ${m.qty ? ` • ${escapeHtml(m.qty)}` : ''}
    </div>
  `).join('') || '<p style="color:var(--text-muted);font-size:13px">لا توجد أدوية مسجلة</p>';

  const historyHtml = (p.dispenseHistory || []).slice(0, 10).map(h => `
    <div class="dispense-row">
      <span>📅 ${new Date(h.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <span>${h.amount ? '💰 ' + h.amount + ' ر.ي' : ''}</span>
    </div>
  `).join('') || '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:8px">لا يوجد سجل صرف</p>';

  content.innerHTML = `
    <div class="patient-detail">
      <div class="patient-detail__header">
        <h3 class="patient-detail__name">${escapeHtml(p.name)} ${isVip ? '<span class="patient-card__vip">⭐ VIP</span>' : ''}</h3>
        <button class="modal__close" onclick="document.getElementById('patient-modal').classList.add('hidden')">✕</button>
      </div>

      <div class="patient-card__conditions" style="margin-bottom:12px">${conditionsHtml}</div>
      <div class="patient-card__phone" style="margin-bottom:12px">📞 ${escapeHtml(p.phone)}</div>
      ${p.age ? `<div style="font-size:13px;color:var(--text-soft);margin-bottom:4px">🎂 العمر: ${p.age} سنة</div>` : ''}
      ${p.address ? `<div style="font-size:13px;color:var(--text-soft);margin-bottom:4px">📍 ${escapeHtml(p.address)}</div>` : ''}
      ${p.notes ? `<div style="font-size:13px;background:var(--primary-50);padding:8px;border-radius:8px;margin-top:8px">📝 ${escapeHtml(p.notes)}</div>` : ''}

      <p class="patient-detail__section">📊 إحصائيات</p>
      <div class="patient-detail__stats">
        <div class="patient-stat">
          <div class="patient-stat__value">${p.dispenseHistory ? p.dispenseHistory.length : 0}</div>
          <div class="patient-stat__label">مرات الشراء</div>
        </div>
        <div class="patient-stat">
          <div class="patient-stat__value">${months}</div>
          <div class="patient-stat__label">أشهر متتالية</div>
        </div>
        <div class="patient-stat">
          <div class="patient-stat__value">${p.totalSpent || 0}</div>
          <div class="patient-stat__label">إجمالي (ر.ي)</div>
        </div>
        <div class="patient-stat">
          <div class="patient-stat__value">${points}</div>
          <div class="patient-stat__label">نقطة ولاء</div>
        </div>
      </div>

      <p class="patient-detail__section">⭐ مستوى الولاء</p>
      <div style="font-size:13px;color:var(--text-soft);margin-bottom:4px">
        ${isVip ? 'عميل مميز! 🎉' : `متبقي ${PATIENT_CONFIG.vipThreshold - months} شهر للترقية إلى VIP`}
      </div>
      <div class="loyalty-bar"><div class="loyalty-bar__fill" style="width:${progressToVip}%"></div></div>

      <p class="patient-detail__section">💊 الأدوية الشهرية</p>
      ${medsHtml}

      <p class="patient-detail__section">📅 سجل الصرف (آخر 10)</p>
      ${historyHtml}

      <p class="patient-detail__section">📱 تواصل سريع</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <a class="btn-pill btn-pill--whatsapp" href="https://wa.me/${phoneToWhatsApp(p.phone)}" target="_blank">📱 واتساب</a>
        <a class="btn-pill btn-pill--primary" href="tel:${escapeHtml(p.phone)}">📞 اتصال</a>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
}

// ============= تنبيهات المرضى (داخل التنبيهات العامة) =============
function getPatientAlerts() {
  const alerts = [];
  state.patients.forEach(p => {
    const days = daysToNextDispense(p);
    const reminderDays = p.reminderDays || 5;
    if (days < 0) {
      alerts.push({
        id: 'pat-over-' + p.id,
        kind: 'urgent',
        icon: '⛔',
        title: `متأخر: ${p.name}`,
        sub: `مر ${Math.abs(days)} يوم على موعد الصرف - ${p.phone}`,
        action: 'تذكير',
        targetItem: p,
      });
    } else if (days === 0) {
      alerts.push({
        id: 'pat-today-' + p.id,
        kind: 'urgent',
        icon: '🔔',
        title: `موعد اليوم: ${p.name}`,
        sub: `حان وقت صرف الأدوية الشهرية - ${p.phone}`,
        action: 'صرف',
        targetItem: p,
      });
    } else if (days <= reminderDays) {
      alerts.push({
        id: 'pat-soon-' + p.id,
        kind: 'warning',
        icon: '⏰',
        title: `يتبقى ${days} يوم: ${p.name}`,
        sub: `سيحين موعد الصرف قريباً - ${p.phone}`,
        action: 'تذكير',
        targetItem: p,
      });
    }
  });
  return alerts.filter(a => !state.dismissedAlerts.includes(a.id));
}

// ============================================
// نظام النسخ الاحتياطي
// ============================================
async function performBackup(type = 'manual') {
  if (!currentUserId && !currentCode) {
    toast('⚠️ يجب تسجيل الدخول أولاً');
    return null;
  }
  const data = {
    shortages: state.shortages,
    expiring: state.expiring,
    patients: state.patients,
    log: state.log.slice(0, 50),
    meta: {
      type,
      timestamp: Date.now(),
      device: getDeviceId().slice(0, 8),
      user: currentUser?.email || currentCode,
      version: '4.0',
      counts: {
        shortages: state.shortages.length,
        expiring: state.expiring.length,
        patients: state.patients.length,
        log: state.log.length,
      },
    },
  };
  try {
    const target = currentUserId
      ? `users/${currentUserId}/backups/${uid()}`
      : `pharmacies/${codeToPath(currentCode)}/backups/${uid()}`;
    await set(ref(db, target), data);

    // تحديث آخر مزامنة
    if (currentUserId) {
      await set(ref(db, `users/${currentUserId}/meta/lastCloudSync`), Date.now());
    }
    if (type === 'manual') {
      toast('✅ تم إنشاء النسخة الاحتياطية');
    }
    await addBackupLog(type, 'success');
    updateBackupStatus();
    return data;
  } catch (e) {
    toast('❌ فشل النسخ الاحتياطي: ' + e.message);
    await addBackupLog(type, 'failed', e.message);
    return null;
  }
}

async function addBackupLog(type, status, error = '') {
  const entry = {
    id: uid(),
    type,        // 'manual' | 'auto' | 'restore' | 'import' | 'export'
    status,      // 'success' | 'failed'
    error,
    timestamp: Date.now(),
    device: getDeviceId().slice(0, 8),
    user: currentUser?.email || currentCode || 'مجهول',
  };
  try {
    if (currentUserId) {
      await set(ref(db, `users/${currentUserId}/backupLog/${entry.id}`), entry);
    }
  } catch (e) { /* ignore */ }
  renderBackups();
}

async function restoreBackup(backupId) {
  try {
    const path = currentUserId
      ? `users/${currentUserId}/backups/${backupId}`
      : `pharmacies/${codeToPath(currentCode)}/backups/${backupId}`;
    const snap = await get(child(ref(db), path));
    if (!snap.exists()) {
      toast('❌ النسخة غير موجودة');
      return false;
    }
    const data = snap.val();
    const ok = await confirmDialog({
      title: '⚠️ تأكيد الاستعادة',
      message: `سيتم استبدال جميع البيانات الحالية بنسخة ${new Date(data.meta.timestamp).toLocaleString('ar-EG')}.\n\nيحتوي على:\n• ${data.meta.counts.shortages} صنف ناقص\n• ${data.meta.counts.expiring} صنف قارب انتهاء\n• ${data.meta.counts.patients} مريض\n\nهل أنت متأكد؟`,
      okText: 'نعم، استعادة',
    });
    if (!ok) return false;

    // استبدال البيانات
    if (currentUserId) {
      await set(ref(db, `users/${currentUserId}/shortages`), data.shortages || {});
      await set(ref(db, `users/${currentUserId}/expiring`), data.expiring || {});
      await set(ref(db, `users/${currentUserId}/patients`), data.patients || {});
      await set(ref(db, `users/${currentUserId}/log`), data.log || {});
    } else {
      await set(ref(db, `pharmacies/${codeToPath(currentCode)}/shortages`), data.shortages || {});
      await set(ref(db, `pharmacies/${codeToPath(currentCode)}/expiring`), data.expiring || {});
      await set(ref(db, `pharmacies/${codeToPath(currentCode)}/patients`), data.patients || {});
      await set(ref(db, `pharmacies/${codeToPath(currentCode)}/log`), data.log || {});
    }
    toast('✅ تمت الاستعادة بنجاح');
    await addBackupLog('restore', 'success');
    return true;
  } catch (e) {
    toast('❌ فشلت الاستعادة: ' + e.message);
    return false;
  }
}

function updateBackupStatus() {
  const lastCloud = $('#last-cloud-sync');
  const lastBackup = $('#last-backup-time');
  const countEl = $('#backup-count');
  if (lastCloud) {
    lastCloud.textContent = state.lastCloudSync
      ? new Date(state.lastCloudSync).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '— لم تتم بعد —';
  }
  const backups = state.backups || [];
  if (lastBackup) {
    lastBackup.textContent = backups.length
      ? new Date(backups[0].meta.timestamp).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '— لم تتم بعد —';
  }
  if (countEl) {
    countEl.textContent = backups.length;
  }
  // تحديث الـ pill في الأعلى
  const pill = $('#backup-status-pill');
  if (pill) {
    if (backups.length > 0) {
      const ageHours = (Date.now() - backups[0].meta.timestamp) / (1000 * 60 * 60);
      if (ageHours < 24) pill.innerHTML = '🟢 محفوظ';
      else if (ageHours < 72) pill.innerHTML = '🟡 قبل يومين';
      else pill.innerHTML = '🔴 قديم';
    } else {
      pill.innerHTML = '⚪ غير محفوظ';
    }
  }
}

function renderBackups() {
  const list = $('#backup-log');
  if (!list) return;
  const backups = state.backups || [];
  if (!backups.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:13px;padding:20px">لا توجد نسخ احتياطية. اضغط "نسخ احتياطي الآن" لإنشاء أول نسخة.</p>';
    return;
  }
  const typeLabels = {
    auto: { icon: '⏰', label: 'تلقائية', class: 'backup-log-item--auto' },
    welcome: { icon: '🎉', label: 'ترحيب', class: 'backup-log-item--auto' },
    manual: { icon: '👆', label: 'يدوية', class: 'backup-log-item--manual' },
    restore: { icon: '🔄', label: 'استعادة', class: 'backup-log-item--restore' },
  };
  // عرض آخر 20 عملية
  list.innerHTML = backups.slice(0, 20).map(b => {
    const meta = typeLabels[b.meta?.type] || typeLabels.manual;
    const time = new Date(b.meta.timestamp).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const counts = b.meta.counts || {};
    return `
      <div class="backup-log-item ${meta.class}">
        <div style="flex:1">
          <div style="font-weight:700;color:var(--text)">${meta.icon} ${meta.label} · ${time}</div>
          <div style="font-size:11px;color:var(--text-soft);margin-top:2px">
            ${counts.shortages || 0} ناقص · ${counts.expiring || 0} انتهاء · ${counts.patients || 0} مريض · 📱 ${b.meta.device || '—'}
          </div>
        </div>
        <button class="btn-mini btn-mini--success" data-restore="${b.id}" title="استعادة">↩</button>
      </div>
    `;
  }).join('');
  $$('[data-restore]', list).forEach(btn => {
    btn.onclick = () => restoreBackup(btn.dataset.restore);
  });
}

// نسخ احتياطي تلقائي دوري
function startAutoBackup() {
  if (!BACKUP_CONFIG.autoBackupEnabled) return;
  // نسخ احتياطي كل X ساعة
  setInterval(() => {
    if (currentUserId || currentCode) {
      performAutoBackup('auto');
    }
  }, BACKUP_CONFIG.autoBackupIntervalHours * 60 * 60 * 1000);
}

function performAutoBackup(reason = 'auto') {
  // تحقق من آخر نسخة احتياطية
  const last = (state.backups || [])[0];
  if (last) {
    const ageHours = (Date.now() - last.meta.timestamp) / (1000 * 60 * 60);
    // إذا أحدث من X ساعة، لا تنشئ
    if (ageHours < 1 && reason === 'auto') return;
  }
  return performBackup(reason);
}

function setupBackup() {
  // نسخ احتياطي يدوي
  $('#backup-now').addEventListener('click', async () => {
    const result = await performBackup('manual');
    if (result) renderBackups();
  });

  // استعادة آخر نسخة
  $('#restore-latest').addEventListener('click', async () => {
    const backups = state.backups || [];
    if (!backups.length) {
      toast('⚠️ لا توجد نسخ احتياطية');
      return;
    }
    await restoreBackup(backups[0].id);
  });

  // تصدير JSON
  $('#export-json').addEventListener('click', () => {
    const data = {
      version: '4.0',
      exportedAt: new Date().toISOString(),
      counts: {
        shortages: state.shortages.length,
        expiring: state.expiring.length,
        patients: state.patients.length,
        log: state.log.length,
      },
      shortages: state.shortages,
      expiring: state.expiring,
      patients: state.patients,
      log: state.log,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alamin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`✅ تم تصدير ${data.counts.shortages + data.counts.expiring + data.counts.patients} عنصر`);
    addBackupLog('export', 'success');
  });

  // استيراد JSON
  $('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.shortages && !data.expiring && !data.patients) {
        toast('❌ ملف غير صالح');
        return;
      }
      const ok = await confirmDialog({
        title: '⚠️ تأكيد الاستيراد',
        message: `سيتم استبدال البيانات الحالية بـ:\n• ${(data.shortages || []).length} ناقص\n• ${(data.expiring || []).length} انتهاء\n• ${(data.patients || []).length} مريض\n\nهل أنت متأكد؟`,
        okText: 'نعم، استيراد',
      });
      if (!ok) return;
      // الكتابة في السحابة
      const root = currentUserId
        ? `users/${currentUserId}`
        : `pharmacies/${codeToPath(currentCode)}`;
      await set(ref(db, `${root}/shortages`), data.shortages || {});
      await set(ref(db, `${root}/expiring`), data.expiring || {});
      await set(ref(db, `${root}/patients`), data.patients || {});
      toast('✅ تم الاستيراد بنجاح');
      addBackupLog('import', 'success');
    } catch (err) {
      toast('❌ فشل قراءة الملف: ' + err.message);
    }
    e.target.value = ''; // reset
  });
}

// ============================================
// التبويبات
// ============================================
function setupTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + target));
    });
  });
}

// ============================================
// النواقص
// ============================================
function renderShortages() {
  const list = $('#shortages-list');
  const actions = $('#shortages-actions');
  const badge = $('#badge-shortages');
  const items = state.shortages;
  const active = items.filter(x => !x.done);
  badge.textContent = active.length;

  // تطبيق الفلاتر
  let filtered = active.slice();
  if (filters.shortagesSearch) {
    const q = filters.shortagesSearch.toLowerCase();
    filtered = filtered.filter(it =>
      (it.name || '').toLowerCase().includes(q) ||
      (it.notes || '').toLowerCase().includes(q) ||
      (it.company || '').toLowerCase().includes(q) ||
      (it.supplier || '').toLowerCase().includes(q)
    );
  }
  if (filters.shortagesCategory) {
    filtered = filtered.filter(it => (it.category || '') === filters.shortagesCategory);
  }
  if (filters.shortagesPriority) {
    filtered = filtered.filter(it => (it.priority || 'medium') === filters.shortagesPriority);
  }

  if (!active.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">📦</div>
        <p>لا توجد نواقص نشطة. ابدأ بإضافة صنف ناقص.</p>
      </div>`;
    actions.classList.add('hidden');
    return;
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">🔍</div>
        <p>لا توجد نتائج تطابق البحث/الفلتر.</p>
      </div>`;
    actions.classList.remove('hidden');
    return;
  }

  actions.classList.remove('hidden');
  // ترتيب حسب الأولوية ثم التاريخ
  filtered.sort((a, b) => {
    const pa = (PRIORITIES[a.priority] || PRIORITIES.medium).order;
    const pb = (PRIORITIES[b.priority] || PRIORITIES.medium).order;
    if (pa !== pb) return pa - pb;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const reasonLabel = (key) => {
    const r = SHORTAGE_REASONS.find(x => x.key === key);
    return r ? r.label : '';
  };

  list.innerHTML = filtered.map((it) => {
    const date = it.createdAt ? new Date(it.createdAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : '';
    const lowStock = it.minStock && it.currentStock != null && it.currentStock <= it.minStock;
    const priority = PRIORITIES[it.priority] || PRIORITIES.medium;
    return `
      <div class="item ${lowStock ? 'item--alert' : ''}" data-id="${it.id}" style="border-right: 4px solid ${priority.color}">
        <div class="item__body">
          <div class="item__name">
            <span class="priority-indicator" style="background:${priority.color}" title="الأولوية: ${priority.label}">${priority.emoji}</span>
            ${escapeHtml(it.name)}
            ${lowStock ? '<span class="tag tag--urgent" title="وصل للحد الأدنى">⚠️ منخفض</span>' : ''}
          </div>
          <div class="item__meta">
            ${it.quantity ? `<span class="item__meta-item"><span class="tag tag--qty">📦 كمية: ${escapeHtml(it.quantity)}</span></span>` : ''}
            ${it.currentStock != null ? `<span class="item__meta-item"><span class="tag tag--${lowStock ? 'urgent' : 'safe'}">📊 حالي: ${escapeHtml(it.currentStock)}</span></span>` : ''}
            ${it.minStock ? `<span class="item__meta-item"><span class="tag tag--date">📉 حد أدنى: ${escapeHtml(it.minStock)}</span></span>` : ''}
            ${it.category ? `<span class="item__meta-item"><span class="tag">🏷️ ${escapeHtml(it.category)}</span></span>` : ''}
            ${it.company ? `<span class="item__meta-item"><span class="tag">🏭 ${escapeHtml(it.company)}</span></span>` : ''}
            ${it.supplier ? `<span class="item__meta-item"><span class="tag" style="background:#EDE9FE;color:#5B21B6">🚚 ${escapeHtml(it.supplier)}</span></span>` : ''}
            ${it.lastPrice ? `<span class="item__meta-item"><span class="tag" style="background:#FEF3C7;color:#92400E">💰 ${escapeHtml(it.lastPrice)} ر.ي</span></span>` : ''}
            ${it.reason ? `<span class="item__meta-item"><span class="tag" style="background:#FEE2E2;color:#991B1B">📌 ${escapeHtml(reasonLabel(it.reason))}</span></span>` : ''}
            ${date ? `<span class="item__meta-item">📅 ${date}</span>` : ''}
            ${it.notes ? `<span class="item__meta-item">📝 ${escapeHtml(it.notes)}</span>` : ''}
            ${it.by ? `<span class="item__meta-item" title="أُضيف من جهاز">📱</span>` : ''}
          </div>
        </div>
        <div class="item__actions">
          <button class="btn-mini btn-mini--success" data-provided title="تم توفير الصنف" aria-label="تم توفيره">✅</button>
          <button class="icon-btn" data-edit aria-label="تعديل">✏️</button>
          <button class="icon-btn icon-btn--danger" data-delete aria-label="حذف">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

function setupShortages() {
  const form = $('#form-shortage');
  const wrap = form;
  let editingId = null;

  // ملء datalist بالفئات والشركات والموردين
  function refreshDatalists() {
    const catsList = $('#categories-list');
    const compsList = $('#companies-list');
    const supsList = $('#suppliers-list');
    const cats = new Set([...DEFAULT_CATEGORIES, ...state.shortages.map(s => s.category).filter(Boolean)]);
    const comps = new Set([...DEFAULT_COMPANIES, ...state.shortages.map(s => s.company).filter(Boolean)]);
    const sups = new Set([...state.shortages.map(s => s.supplier).filter(Boolean)]);
    if (catsList) catsList.innerHTML = [...cats].map(c => `<option value="${escapeHtml(c)}">`).join('');
    if (compsList) compsList.innerHTML = [...comps].map(c => `<option value="${escapeHtml(c)}">`).join('');
    if (supsList) supsList.innerHTML = [...sups].map(c => `<option value="${escapeHtml(c)}">`).join('');

    // ملء فلتر الفئات
    const filterSel = $('#filter-shortages-cat');
    if (filterSel) {
      const current = filterSel.value;
      filterSel.innerHTML = '<option value="">كل الفئات</option>' +
        [...cats].map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      filterSel.value = current;
    }
  }

  $('#add-shortage').addEventListener('click', () => {
    editingId = null;
    $('.form__title', wrap).textContent = 'إضافة صنف ناقص';
    form.reset();
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) {
      $('input[name="name"]', wrap).focus();
    }
  });
  $('[data-cancel]', wrap).addEventListener('click', () => {
    wrap.classList.add('hidden');
    form.reset();
    editingId = null;
    $('.form__title', wrap).textContent = 'إضافة صنف ناقص';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    if (!name) return;
    const payload = {
      name,
      quantity: Number(fd.get('quantity')) || 1,
      currentStock: fd.get('currentStock') !== '' ? Number(fd.get('currentStock')) : null,
      minStock: fd.get('minStock') !== '' ? Number(fd.get('minStock')) : null,
      category: (fd.get('category') || '').toString().trim(),
      company: (fd.get('company') || '').toString().trim(),
      priority: (fd.get('priority') || 'medium').toString(),
      reason: (fd.get('reason') || '').toString(),
      supplier: (fd.get('supplier') || '').toString().trim(),
      lastPrice: fd.get('lastPrice') !== '' ? Number(fd.get('lastPrice')) : null,
      notes: (fd.get('notes') || '').toString().trim(),
    };

    if (editingId) {
      const existing = state.shortages.find(x => x.id === editingId);
      if (existing) {
        const updated = { ...existing, ...payload };
        await pushItem('shortages', updated);
        await logAction('edit', {
          type: 'shortage',
          name,
          summary: `تعديل الصنف "${name}"`,
        });
        toast('تم تعديل الصنف ✅ ومزامنته');
      }
    } else {
      const item = {
        id: uid(),
        ...payload,
        done: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        by: getDeviceId().slice(0, 8),
      };
      await pushItem('shortages', item);
      await logAction('add', {
        type: 'shortage',
        name,
        summary: `إضافة صنف ناقص "${name}"`,
      });
      toast('تمت إضافة الصنف ✅ ومزامنته');
    }

    form.reset();
    editingId = null;
    $('.form__title', wrap).textContent = 'إضافة صنف ناقص';
    wrap.classList.add('hidden');
    refreshDatalists();
  });

  $('#shortages-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    const id = item.dataset.id;

    if (e.target.closest('[data-toggle]')) {
      const it = state.shortages.find((x) => x.id === id);
      if (it) {
        it.done = !it.done;
        await pushItem('shortages', it);
        await logAction('edit', {
          type: 'shortage',
          name: it.name,
          summary: `${it.done ? 'تأكيد توفر' : 'إلغاء تأكيد'} "${it.name}"`,
        });
      }
      return;
    }
    if (e.target.closest('[data-edit]')) {
      const it = state.shortages.find((x) => x.id === id);
      if (!it) return;
      editingId = id;
      $('.form__title', wrap).textContent = 'تعديل الصنف';
      $('input[name="name"]', wrap).value = it.name || '';
      $('input[name="quantity"]', wrap).value = it.quantity || 1;
      $('input[name="currentStock"]', wrap).value = it.currentStock != null ? it.currentStock : '';
      $('input[name="minStock"]', wrap).value = it.minStock || '';
      $('input[name="category"]', wrap).value = it.category || '';
      $('input[name="company"]', wrap).value = it.company || '';
      $('select[name="priority"]', wrap).value = it.priority || 'medium';
      $('select[name="reason"]', wrap).value = it.reason || '';
      $('input[name="supplier"]', wrap).value = it.supplier || '';
      $('input[name="lastPrice"]', wrap).value = it.lastPrice != null ? it.lastPrice : '';
      $('textarea[name="notes"]', wrap).value = it.notes || '';
      wrap.classList.remove('hidden');
      $('input[name="name"]', wrap).focus();
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (e.target.closest('[data-provided]')) {
      const it = state.shortages.find((x) => x.id === id);
      if (!it) return;
      // تأكيد سريع
      const ok = await confirmDialog({
        title: '✅ تأكيد توفير الصنف',
        message: `هل تم شراء "${it.name}" وتوفّر في الصيدلية؟ سيُحذف من قائمة النواقص النشطة ويُسجّل في السجل.`,
        okText: 'نعم، تم التوفير',
        danger: false,
      });
      if (!ok) return;
      await removeItem('shortages', id);
      await logAction('system', {
        type: 'shortage',
        name: it.name,
        summary: `✅ تم توفير الصنف "${it.name}"${it.supplier ? ` من المورد ${it.supplier}` : ''}`,
      });
      toast(`✅ تم توفير ${it.name}`);
      return;
    }
    if (e.target.closest('[data-delete]')) {
      const it = state.shortages.find((x) => x.id === id);
      const ok = await confirmDialog({
        title: 'حذف الصنف',
        message: `هل تريد حذف "${it?.name || 'هذا الصنف'}" من جميع الأجهزة؟`,
      });
      if (!ok) return;
      await removeItem('shortages', id);
      await logAction('delete', {
        type: 'shortage',
        name: it?.name || '',
        summary: `حذف صنف "${it?.name || ''}"`,
      });
      toast('تم الحذف');
    }
  });

  $('#clear-shortages').addEventListener('click', async () => {
    if (!state.shortages.length) return;
    const ok = await confirmDialog({
      title: 'مسح جميع النواقص',
      message: `سيتم حذف ${state.shortages.length} صنف من جميع الأجهزة. هل أنت متأكد؟`,
    });
    if (!ok) return;
    const count = state.shortages.length;
    await clearKind('shortages');
    await logAction('system', {
      type: 'shortage',
      summary: `مسح جميع النواقص (${count} صنف)`,
    });
    toast('تم مسح القائمة من جميع الأجهزة');
  });

  $('#share-shortages').addEventListener('click', () => shareList('shortages'));
  $('#share-purchase').addEventListener('click', () => shareList('shortages', { asPurchaseOrder: true }));

  // الفلاتر
  $('#filter-shortages').addEventListener('input', (e) => {
    filters.shortagesSearch = e.target.value;
    renderShortages();
  });
  $('#filter-shortages-cat').addEventListener('change', (e) => {
    filters.shortagesCategory = e.target.value;
    renderShortages();
  });
  $('#filter-shortages-priority').addEventListener('change', (e) => {
    filters.shortagesPriority = e.target.value;
    renderShortages();
  });

  refreshDatalists();
}

// ============================================
// قرب الانتهاء
// ============================================
function expiringTag(days) {
  if (days == null) return '';
  if (days < 0) return '<span class="tag tag--urgent">منتهي</span>';
  if (days <= 30) return '<span class="tag tag--urgent">حرج</span>';
  if (days <= 90) return '<span class="tag tag--warning">قريب</span>';
  return '<span class="tag tag--safe">آمن</span>';
}

function renderExpiring() {
  const list = $('#expiring-list');
  const actions = $('#expiring-actions');
  const badge = $('#badge-expiring');
  const items = state.expiring;
  badge.textContent = items.length;

  if (!items.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⏰</div>
        <p>لا توجد أصناف قريبة الانتهاء مسجلة.</p>
      </div>`;
    actions.classList.add('hidden');
    return;
  }

  actions.classList.remove('hidden');
  list.innerHTML = items
    .slice()
    .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''))
    .map((it) => {
      const days = daysUntil(it.expiryDate);
      return `
      <div class="item" data-id="${it.id}">
        <div class="item__body">
          <div class="item__name">${escapeHtml(it.name)} ${expiringTag(days)}</div>
          <div class="item__meta">
            ${it.expiryDate ? `<span class="item__meta-item"><span class="tag tag--date">📅 ${formatDate(it.expiryDate)}</span></span>` : ''}
            ${days != null ? `<span class="item__meta-item">⏳ ${days < 0 ? 'منتهي منذ ' + Math.abs(days) + ' يوم' : 'متبقي ' + days + ' يوم'}</span>` : ''}
            ${it.quantity ? `<span class="item__meta-item"><span class="tag tag--qty">الكمية: ${escapeHtml(it.quantity)}</span></span>` : ''}
            ${it.batch ? `<span class="item__meta-item">🔖 دفعة: ${escapeHtml(it.batch)}</span>` : ''}
            ${it.notes ? `<span class="item__meta-item">📝 ${escapeHtml(it.notes)}</span>` : ''}
            ${it.by ? `<span class="item__meta-item" title="أُضيف من جهاز آخر">📱</span>` : ''}
          </div>
        </div>
        <div class="item__actions">
          <button class="icon-btn icon-btn--danger" data-delete aria-label="حذف">🗑️</button>
        </div>
      </div>`;
    })
    .join('');
}

function setupExpiring() {
  const form = $('#form-expiring');
  const wrap = form;

  $('#add-expiring').addEventListener('click', () => {
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) {
      $('input[name="name"]', wrap).focus();
    }
  });
  $('[data-cancel]', wrap).addEventListener('click', () => {
    wrap.classList.add('hidden');
    wrap.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    if (!name) return;
    const item = {
      id: uid(),
      name,
      quantity: Number(fd.get('quantity')) || 1,
      expiryDate: (fd.get('expiryDate') || '').toString(),
      batch: (fd.get('batch') || '').toString().trim(),
      notes: (fd.get('notes') || '').toString().trim(),
      createdAt: Date.now(),
      by: getDeviceId().slice(0, 8),
    };
    await pushItem('expiring', item);
    await logAction('add', {
      type: 'expiring',
      name,
      summary: `إضافة صنف "${name}" - انتهاء ${item.expiryDate || 'غير محدد'}`,
    });
    form.reset();
    wrap.classList.add('hidden');
    toast('تمت إضافة الصنف ✅ ومزامنته');
  });

  $('#expiring-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: 'حذف الصنف',
        message: 'هل تريد حذف هذا الصنف من جميع الأجهزة؟',
      });
      if (!ok) return;
      await removeItem('expiring', id);
      await logAction('delete', {
        type: 'expiring',
        name: it?.name || '',
        summary: `حذف صنف "${it?.name || ''}"`,
      });
      toast('تم الحذف');
    }
  });

  $('#clear-expiring').addEventListener('click', async () => {
    if (!state.expiring.length) return;
    const ok = await confirmDialog({
      title: 'مسح جميع الأصناف',
      message: `سيتم حذف ${state.expiring.length} صنف من جميع الأجهزة. هل أنت متأكد؟`,
    });
    if (!ok) return;
    const count = state.expiring.length;
    await clearKind('expiring');
    await logAction('system', {
      type: 'expiring',
      summary: `مسح جميع الأصناف (${count} صنف)`,
    });
    toast('تم مسح القائمة من جميع الأجهزة');
  });

  $('#share-expiring').addEventListener('click', () => shareList('expiring'));
}

// ============================================
// المشاركة عبر واتساب
// ============================================
function buildMessage(kind, options = {}) {
  const lines = [];
  const now = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  if (kind === 'shortages') {
    const items = state.shortages.filter(x => !x.done);

    if (options.asPurchaseOrder) {
      lines.push(`━━━━━━━━━━━━━━━━━`);
      lines.push(`💊 *طلبية شراء*`);
      lines.push(`🏥 *${PHARMACY.name}*`);
      lines.push(`📅 التاريخ: ${now}`);
      lines.push(`📞 الهاتف: ${PHARMACY.phone}`);
      lines.push(`📍 ${PHARMACY.address}`);
      lines.push(`━━━━━━━━━━━━━━━━━`);
      lines.push(``);
      if (!items.length) {
        lines.push(`✅ لا توجد أصناف بحاجة للطلب حالياً.`);
      } else {
        // ترتيب حسب الأولوية (العاجل أولاً)
        const sorted = items.slice().sort((a, b) => {
          const pa = (PRIORITIES[a.priority] || PRIORITIES.medium).order;
          const pb = (PRIORITIES[b.priority] || PRIORITIES.medium).order;
          return pa - pb;
        });
        // تجميع حسب المورد أولاً، ثم الشركة
        const bySupplier = {};
        sorted.forEach(it => {
          const s = it.supplier || 'بدون مورد محدد';
          if (!bySupplier[s]) bySupplier[s] = [];
          bySupplier[s].push(it);
        });
        let i = 1;
        Object.keys(bySupplier).forEach(supplier => {
          lines.push(`🚚 *المورّد: ${supplier}*`);
          // داخل المورد، تجميع حسب الشركة
          const byCompany = {};
          bySupplier[supplier].forEach(it => {
            const c = it.company || 'بدون شركة';
            if (!byCompany[c]) byCompany[c] = [];
            byCompany[c].push(it);
          });
          Object.keys(byCompany).sort().forEach(company => {
            lines.push(`   🏭 ${company}`);
            byCompany[company].forEach(it => {
              const priority = PRIORITIES[it.priority] || PRIORITIES.medium;
              const stock = it.currentStock != null ? ` (موجود: ${it.currentStock}` : '';
              const min = it.minStock ? ` / حد أدنى: ${it.minStock})` : (it.currentStock != null ? ')' : '');
              const price = it.lastPrice ? ` | 💰 ${it.lastPrice} ر.ي` : '';
              const reason = it.reason ? ` | 📌 ${SHORTAGE_REASONS.find(r => r.key === it.reason)?.label || it.reason}` : '';
              lines.push(`   ${i}. ${priority.emoji} ${it.name} × ${it.quantity}${stock}${min}${price}${reason}${it.category ? ` _(${it.category})_` : ''}`);
              i++;
            });
          });
          lines.push(``);
        });
        // ملخص حسب الأولوية
        const byPriority = { urgent: 0, medium: 0, normal: 0 };
        items.forEach(it => {
          const p = it.priority || 'medium';
          byPriority[p] = (byPriority[p] || 0) + 1;
        });
        lines.push(`━━━━━━━━━━━━━━━━━`);
        lines.push(`📦 *إجمالي الأصناف:* ${items.length}`);
        if (byPriority.urgent) lines.push(`🔴 *عاجل:* ${byPriority.urgent} صنف`);
        if (byPriority.medium) lines.push(`🟡 *متوسط:* ${byPriority.medium} صنف`);
        if (byPriority.normal) lines.push(`🟢 *عادي:* ${byPriority.normal} صنف`);
        const suppliers = Object.keys(bySupplier).filter(s => s !== 'بدون مورد محدد');
        if (suppliers.length) lines.push(`🚚 *الموردون:* ${suppliers.length}`);
        // إجمالي تقريبي للسعر
        const totalPrice = items.reduce((sum, it) => sum + ((it.lastPrice || 0) * (it.quantity || 1)), 0);
        if (totalPrice > 0) lines.push(`💰 *التكلفة التقريبية:* ${totalPrice.toLocaleString('ar-EG')} ر.ي`);
      }
      lines.push(``);
      lines.push(`⚡ تم إنشاء هذه الطلبية آلياً من نظام إدارة ${PHARMACY.name}`);
    } else {
      lines.push(`💊 *صيدلية الأمين الحديثة*`);
      lines.push(`📋 *قائمة النواقص*`);
      lines.push(`📅 ${now}`);
      lines.push(``);
      if (!items.length) {
        lines.push(`✅ لا توجد نواقص حالياً.`);
      } else {
        const byCategory = {};
        items.forEach(it => {
          const c = it.category || 'غير مصنف';
          if (!byCategory[c]) byCategory[c] = [];
          byCategory[c].push(it);
        });
        let i = 1;
        Object.keys(byCategory).sort().forEach(category => {
          lines.push(`🏷️ *${category}*`);
          byCategory[category].forEach(it => {
            const priority = PRIORITIES[it.priority] || PRIORITIES.medium;
            let line = `${i}. ${priority.emoji} ${it.name}`;
            if (it.quantity) line += ` (×${it.quantity})`;
            if (it.company) line += ` _[${it.company}]_`;
            if (it.reason) {
              const reasonLabel = SHORTAGE_REASONS.find(r => r.key === it.reason)?.label || it.reason;
              line += ` 📌${reasonLabel}`;
            }
            lines.push(line);
            i++;
          });
          lines.push(``);
        });
      }
      lines.push(`📞 للتواصل: ${PHARMACY.phone}`);
      lines.push(`📍 ${PHARMACY.address}`);
    }
  } else if (kind === 'expiring') {
    const items = state.expiring;
    lines.push(`💊 *صيدلية الأمين الحديثة*`);
    lines.push(`⏰ *الأصناف قريبة الانتهاء*`);
    lines.push(`📅 ${now}`);
    lines.push(``);
    if (!items.length) {
      lines.push(`✅ لا توجد أصناف قريبة الانتهاء حالياً.`);
    } else {
      const sorted = items.slice().sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));
      let i = 1;
      sorted.forEach(it => {
        const days = daysUntil(it.expiryDate);
        let emoji = '🟢';
        if (days != null) {
          if (days < 0) emoji = '💀';
          else if (days <= 30) emoji = '🔴';
          else if (days <= 90) emoji = '🟡';
        }
        const urgency = days != null
          ? (days < 0 ? `منتهي منذ ${Math.abs(days)} يوم` : `${days} يوم`)
          : '';
        lines.push(`${emoji} ${i}. *${it.name}*`);
        lines.push(`   📅 ${formatDate(it.expiryDate)} _(${urgency})_`);
        if (it.quantity) lines.push(`   📦 كمية: ${it.quantity}`);
        if (it.batch) lines.push(`   🔖 دفعة: ${it.batch}`);
        i++;
      });
    }
    lines.push(``);
    lines.push(`📞 للتواصل: ${PHARMACY.phone}`);
    lines.push(`📍 ${PHARMACY.address}`);
  }

  return lines.join('\n');
}

function shareList(kind, options = {}) {
  const message = buildMessage(kind, options);
  const url = `https://wa.me/${PHARMACY.whatsapp}?text=${encodeURIComponent(message)}`;

  if (navigator.share) {
    navigator.share({
      text: message,
      title: PHARMACY.name,
    }).catch(() => {
      window.open(url, '_blank');
    });
    return;
  }

  window.open(url, '_blank');
}

// ============================================
// تسجيل الخروج
// ============================================
function setupLogout() {
  $('#logout-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'تسجيل الخروج',
      message: currentUser
        ? `سيتم تسجيل الخروج من حساب ${currentUser.email}.\nستظل بياناتك محفوظة في السحابة ومتاحة عند الدخول مجدداً.`
        : 'سيتم قطع المزامنة مع الأجهزة الأخرى. ستظل البيانات محفوظة في السحابة.',
      okText: 'تسجيل الخروج',
    });
    if (!ok) return;
    try {
      if (currentUser) {
        // ⚡ تسجيل خروج من Firebase Auth
        const authApp = initializeApp(firebaseConfig, 'alamin-auth');
        const auth = getAuth(authApp);
        await signOut(auth);
      }
    } catch (e) {
      console.warn('SignOut error:', e);
    }
    clearCode();
    clearUser();
    location.reload();
  });
}

// ============================================
// حذف كل البيانات
// ============================================
function setupReset() {
  $('#reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '⚠️ حذف جميع البيانات',
      message: 'سيتم حذف جميع القوائم من السحابة ومن جميع الأجهزة نهائياً. لا يمكن التراجع!',
      okText: 'احذف الكل',
    });
    if (!ok) return;
    try {
      await clearKind('shortages');
      await clearKind('expiring');
      toast('تم حذف جميع البيانات');
    } catch (e) {
      toast('فشل الحذف: ' + e.message);
    }
  });
}

// ============================================
// PWA Installation
// ============================================
function setupInstall() {
  const banner = $('#install-banner');
  const installBtn = $('#install-btn');
  const dismiss = $('#dismiss-install');
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  installBtn.addEventListener('click', async () => {
    banner.classList.add('hidden');
    if (!deferredInstallPrompt) {
      toast('يمكنك تثبيت التطبيق من قائمة المتصفح');
      return;
    }
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') toast('جاري التثبيت...');
    deferredInstallPrompt = null;
  });

  dismiss.addEventListener('click', () => banner.classList.add('hidden'));

  setTimeout(() => {
    if (deferredInstallPrompt && !sessionStorage.getItem('installDismissed')) {
      banner.classList.remove('hidden');
    }
  }, 5000);

  window.addEventListener('appinstalled', () => {
    banner.classList.add('hidden');
    toast('تم تثبيت التطبيق بنجاح ✅');
  });
}

// ============================================
// Service Worker
// ============================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

// ============================================
// تشغيل
// ============================================
function init() {
  setupAuth();
  setupTabs();
  setupShortages();
  setupExpiring();
  setupPatients();
  setupAlerts();
  setupLog();
  setupBackup();
  setupReset();
  setupLogout();
  setupInstall();
  registerSW();
  startAutoBackup();
  setSyncState('connecting', 'في انتظار الدخول');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
