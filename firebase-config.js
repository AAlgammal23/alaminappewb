/* ============================================
   إعدادات Firebase - صيدلية الأمين الحديثة
   ✅ تم تعبئة المفاتيح الحقيقية
   ============================================ */

export const firebaseConfig = {
  apiKey: "AIzaSyCl5QeW5h5S9Q3ATKZFYHFfK10J2eVVK5s",
  authDomain: "alamin-pharmacy.firebaseapp.com",
  // databaseURL تُبنى تلقائياً من projectId في حال لم تكن موجودة
  databaseURL: "https://alamin-pharmacy-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "alamin-pharmacy",
  storageBucket: "alamin-pharmacy.firebasestorage.app",
  messagingSenderId: "846568696134",
  appId: "1:846568696134:web:857edc96de8aa3383b5d47",
  measurementId: "G-N2WEW5GR62"
};

/* ============================================
   إعدادات اختيارية
   ============================================ */

// الكود الافتراضي للصيدلية
// ⚠️ غيّره إلى كود سري تختاره أنت وشاركه مع فريقك
export const DEFAULT_PHARMACY_CODE = "alamin2026";

// اسم الصيدلية (يظهر في الرسالة الافتراضية)
export const PHARMACY_NAME = "صيدلية الأمين الحديثة";

// الفئات الدوائية الافتراضية
export const DEFAULT_CATEGORIES = [
  "مسكنات",
  "مضادات حيوية",
  "فيتامينات",
  "أدوية مزمنة",
  "مستلزمات طبية",
  "أدوية أطفال",
  "عناية شخصية",
  "مستحضرات تجميل",
  "أخرى"
];

// شركات الأدوية الشائعة (يمكن الإضافة لاحقاً)
export const DEFAULT_COMPANIES = [
  "السبع",
  "الأمل",
  "النقيب فارما",
  "جلفار",
  "الحكمة",
  "أخرى"
];

// إعدادات التنبيهات
export const ALERT_CONFIG = {
  expiryWarningDays: [30, 90, 180],
  lowStockEnabled: true,
  autoSuggestClearance: true
};

// مستويات الأولوية
export const PRIORITIES = {
  urgent:  { key: 'urgent',  label: 'عاجل',  emoji: '🔴', color: '#EF4444', order: 0 },
  medium:  { key: 'medium',  label: 'متوسط', emoji: '🟡', color: '#F59E0B', order: 1 },
  normal:  { key: 'normal',  label: 'عادي',  emoji: '🟢', color: '#10B981', order: 2 },
};

// أسباب النقص
export const SHORTAGE_REASONS = [
  { key: 'out_of_stock',    label: 'نفاد المخزون' },
  { key: 'high_demand',     label: 'طلب متزايد' },
  { key: 'supplier_delay',  label: 'تأخر المورد' },
  { key: 'seasonal',        label: 'موسمي' },
  { key: 'other',           label: 'أخرى' }
];

// الأمراض المزمنة الشائعة
export const CHRONIC_CONDITIONS = [
  { key: 'diabetes',  label: 'السكري',      emoji: '🩸', color: '#EF4444' },
  { key: 'pressure',  label: 'الضغط',       emoji: '❤️', color: '#F97316' },
  { key: 'asthma',    label: 'الربو',       emoji: '🫁', color: '#06B6D4' },
  { key: 'heart',     label: 'أمراض القلب', emoji: '💔', color: '#DC2626' },
  { key: 'thyroid',   label: 'الغدة الدرقية', emoji: '🦋', color: '#8B5CF6' },
  { key: 'kidney',    label: 'أمراض الكلى', emoji: '🫘', color: '#84CC16' },
  { key: 'liver',     label: 'أمراض الكبد', emoji: '🟤', color: '#92400E' },
  { key: 'cholesterol', label: 'الكوليسترول', emoji: '🟡', color: '#EAB308' },
  { key: 'other',     label: 'أخرى',         emoji: '➕', color: '#64748B' },
];

// إعدادات المرضى المزمنين
export const PATIENT_CONFIG = {
  reminderDaysBefore: [3, 5],      // تذكير قبل 3 أو 5 أيام
  defaultCycleDays: 30,            // دورة صرف شهرية
  vipThreshold: 6,                 // عميل مميز بعد 6 أشهر متتالية
  loyaltyPointPerRiyal: 1,         // نقطة لكل 1 ر.ي
  loyaltyRiyalPerPoint: 0.5,       // كل نقطة = 0.5 ر.ي خصم
};

// إعدادات النسخ الاحتياطي
export const BACKUP_CONFIG = {
  autoBackupEnabled: true,
  autoBackupIntervalHours: 24,    // نسخ احتياطي كل 24 ساعة
  maxBackups: 30,                  // نحتفظ بآخر 30 نسخة فقط
  enableAuth: true,                // تفعيل/تعطيل Authentication
};
