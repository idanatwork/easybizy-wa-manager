# WA Manager — Cloudflare Worker

ה-backend של הקונסולה: מקבל webhooks מ-EasyBizy, מריץ את מנוע הבוטים, שומר הכל ב-D1,
ומגיש API מאובטח לאתר הסטטי. הכניסה לקונסולה היא עם Google בלבד: ה-Worker מאמת מול גוגל
את האסימון ומאשר רק מיילים מהרשימה ALLOWED_EMAILS (ב-wrangler.toml). שום סוד לא נמצא בריפו או באתר.

## פריסה ראשונה

```bash
cd worker
npm install -g wrangler          # או: npx wrangler
wrangler login

wrangler d1 create wa-manager
# מעתיקים את database_id לתוך wrangler.toml תחת [[d1_databases]]

wrangler d1 execute wa-manager --file=schema.sql
# אין סיסמאות: הכניסה עם Google בלבד. ממלאים ב-wrangler.toml את GOOGLE_CLIENT_ID
# (מ-Google Cloud Console) ואת ALLOWED_EMAILS (המיילים המורשים).

wrangler deploy
# התוצאה: https://wa-manager.<subdomain>.workers.dev
```

## חיבור האתר

ב-`docs/js/config.js` ממלאים:

```js
const CONFIG = {
  WORKER_URL: "https://wa-manager.<subdomain>.workers.dev",
  GOOGLE_CLIENT_ID: "<אותו Client ID מ-Google Cloud Console>",
};
```

כשהשדה ריק האתר רץ במצב הדגמה עם נתוני דוגמה.

## חיבור לקוח EasyBizy

1. מוסיפים לקוח בקונסולה עם ה-API key וה-secret שלו (מופקים במסוף EasyBizy ע״י בעל החשבון).
2. כתובת ה-webhook של הלקוח: `https://wa-manager.<subdomain>.workers.dev/hook/<webhook_token>`
   (ה-token נוצר אוטומטית ומוצג בהגדרות הלקוח — שדה ה-URL ב-UI יושלם אחרי הפריסה).
3. במסוף EasyBizy ← Webhooks: מדביקים את ה-Payload URL, מפעילים את כל 10 האירועים,
   ומומלץ להגדיר כותרת סוד (ברירת מחדל `X-Webhook-Secret`) ולהזין אותה גם בהגדרות הלקוח אצלנו.
   שים לב: המשלוחים אינם חתומים — הכותרת היא מנגנון האימות היחיד. ניסיונות חוזרים: פעמיים
   נוספות (~דקה וחצי ו-~5 דקות), ואז מייל.

## מגבלות free tier (נכון ל-11/2026)

- Workers: 100,000 בקשות/יום, 10ms CPU לבקשה.
- D1: 5GB אחסון, 5M קריאות/יום, 100K כתיבות/יום.
- EasyBizy API (תוכנית חינם): 120 נקודות/דקה, 20,000 נקודות/יום לחשבון.
