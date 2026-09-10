# שלב 2 של תוכנית הציות: הסכמה (E) וחתימה אלקטרונית (D)

תאריך: 08.09.2026 (לילה). סניף: `compliance/step-1`. המפרט: `docs/compliance-nihul-sfarim-2026-09-08.md`.

שום דבר מהמתואר כאן לא הוחל על מסד הנתונים החי ולא נדחף ל-master. שתי מיגרציות ממתינות:

```
node scripts/run-sql-file.mjs --reason "18b(c) consent + 18b(b) tax officer notice" scripts/migrations/20260909-computerized-documents-consent.sql
```

```
node scripts/run-sql-file.mjs --reason "secured e-signature: keys, signature records, bucket" scripts/migrations/20260910-document-signatures.sql
```

## E. הסכמת הנמען והודעה לפקיד השומה

| מה | איפה |
|---|---|
| שלוש עמודות הסכמה על `clients` + `businesses.tax_officer_notice_sent_at` | `scripts/migrations/20260909-computerized-documents-consent.sql` |
| רישום הסכמה בהורדת ה-PDF או בלחיצה, וביטול, מדף המסמך הציבורי | `src/app/api/public-document/[id]/consent/route.ts`, `src/app/view/[id]/page.tsx` |
| רישום הסכמה "בכתב" / ידני וביטול מכרטיס הלקוח | `src/lib/client-store.ts`, `src/app/(app)/clients/[id]/page.tsx` |
| מצב ההסכמה בדף המסמך של בעל העסק | `src/app/(app)/documents/[id]/page.tsx` |
| משפט ההסכמה במייל למי שטרם הסכים | `src/app/api/send-email/route.ts`, `template.ts` |
| מכתב לפקיד השומה + כרטיס בהגדרות (הבאנר בדשבורד הוסר 10.09.2026) | `src/app/(app)/notices/tax-officer/page.tsx`, `src/components/tax-officer-notice-section.tsx` |
| רישום ב-`audit_log`: `client.consent_recorded`, `client.consent_revoked`, `business.tax_officer_notice` | `src/lib/audit-log.ts` |

הסכמה שבוטלה אינה נמחקת: `computerized_consent_revoked_at` נשאר לצד תאריך ההסכמה המקורי, כי 18ב(ג) דורש שההסכמה והביטול יישמרו "כחלק בלתי נפרד ממערכת החשבונות".

## D. חתימה אלקטרונית מאובטחת

### מה נבנה

| רכיב | קובץ | תפקיד |
|---|---|---|
| זכאות | `src/lib/signing/eligibility.ts` | פונקציה טהורה, משותפת לנייר ולשרת: מי נחתם ומי לא (למטה) |
| מפתח לעסק | `src/lib/signing/keys.ts` | RSA-2048 מ-`node:crypto`, תעודה X.509 בחתימה עצמית (CN = שם העסק, serialNumber = מספר העוסק, 5 שנים), המפתח הפרטי מוצפן ב-`encryptColumn` לפני השמירה |
| חתימה | `src/lib/signing/sign-pdf.ts` | PKCS#7 detached, SHA-256, `adbe.pkcs7.detached`, דרך `@signpdf/signpdf` + `@signpdf/signer-p12` + `node-forge` |
| אימות | `src/lib/signing/verify-pdf.ts` | בודק ByteRange, messageDigest, וחתימת RSA מול התעודה שבתוך הקובץ. ללא רשת וללא DB |
| רשומה וקובץ | `src/lib/signing/store.ts` | `document_signatures` + bucket פרטי `signed-documents` |
| ההחלטה בהפקה | `src/lib/signing/sign-document.ts` | קורא זכאות, חותם, שומר את הקובץ הראשון |
| שילוב במסלול ה-PDF | `src/app/api/documents/[id]/pdf/route.ts` | אחרי הרינדור, לפני חותמת `original_issued_at`. כותרת תשובה `X-Document-Signature: signed / ineligible / failed` |
| דף אימות ציבורי | `src/app/verify/[id]/page.tsx`, `src/app/api/verify/[id]/route.ts` | מה נרשם, האם הקובץ השמור עדיין מאומת, ובדיקת קובץ שהלקוח מעלה |
| על הנייר | `src/components/document-body.tsx`, `receipt-view.tsx`, `document-strings.ts`, `document-paper.css` | "מסמך ממוחשב" רק כשנחתם; אחרת "להדפסה ולשמירה בנייר". שורת תחתית "חתום בחתימה אלקטרונית מאובטחת · אימות: <URL>" |
| לבעל העסק | `src/lib/signature-store.ts`, `src/app/(app)/documents/[id]/page.tsx` | כרטיס: נחתם / ייחתם בהפקה הראשונה / מסמך בנייר ולמה |
| מחיקת חשבון ו"מחק הכל" | `src/app/api/delete-account/route.ts`, `danger/delete-all/route.ts` | מוחקים גם את הקבצים החתומים; הרשומות נופלות ב-CASCADE |
| בדיקות | `tests/signing.test.ts` | 23 בדיקות: מטריצת זכאות, יצירת מפתח ותעודה, PKCS#12, חתימה ואימות, זיהוי שינוי בתוכן, זיהוי חתימה מזויפת, קובץ לא חתום |

### מי נחתם (18ב(ד))

| סוג מסמך | אמצעי תשלום | נחתם? | על הנייר |
|---|---|---|---|
| חשבונית מס, חשבון עסקה, הצעת מחיר, חשבונית זיכוי | כל אחד / ללא | כן | מסמך ממוחשב |
| קבלה, חשבונית מס-קבלה | כרטיס אשראי, שיק, העברה בנקאית | כן | מסמך ממוחשב |
| קבלה, חשבונית מס-קבלה | מזומן, Bit, PayPal, לא נרשם | **לא** | להדפסה ולשמירה בנייר |
| כל סוג | טיוטה | לא | טיוטה |

הסיבה: 18ב(ד) מתיר תשלום על מסמך חתום בחתימה **מאובטחת** רק בכרטיס אשראי, שיק שאינו סחיר או העברה בנקאית. קבלה על מזומן שהאפליקציה תחתום עליה תהיה מסמך שאסור לשלוח. במקום להסתיר את זה, הנייר אומר למשתמש ולנמען מה לעשות. אם רואה החשבון יבחר בחתימה **מאושרת** (החלטה 5.1), המגבלה נופלת ומספיק לשנות את `signingEligibility`.

### סטייה מהמפרט, ולמה

המפרט (סעיף D.2) אמר: לחתום פעם אחת ב-`original_issued_at`, לשמור, וכל הורדה מחזירה את הקובץ השמור. בפועל:

1. **חותמים על כל הפקה** של מסמך זכאי, מקור והעתק. הסיבה: ההעתק של האפליקציה הוא רינדור חדש עם התווית "העתק" ועם "מסמך ממוחשב" (18ב מחייב מקור ללקוח והעתק בספרי העסק, ושניהם מסמכים ממוחשבים). קובץ שכתוב עליו "מסמך ממוחשב" חייב להיות חתום. חתימה עולה מילישניות; Chrome הוא היקר.
2. **הקובץ החתום הראשון נשמר ונרשם** (`document_signatures`, שדה `is_original` אומר אם נשא את תווית המקור). זו הראיה: SHA-256, זמן, טביעת האצבע של התעודה. דף האימות משווה אליה.
3. הורדה חוזרת של הלקוח ממשיכה לקבל "העתק" כמו היום (זו התנהגות קיימת, לא שונתה), רק שעכשיו הוא חתום.

### מה קורה כשהחתימה נכשלת

הקובץ יוצא **לא חתום**, עם `X-Document-Signature: failed` ושורת שגיאה בלוג. ההורדה לא נחסמת כי חסימה תשאיר משתמש בלי מסמך בגלל תקלת תצורה (למשל `COLUMN_ENCRYPTION_KEY` חסר). המחיר: הנייר יאמר "מסמך ממוחשב" על קובץ לא חתום. זה מצב שגיאה שצריך התראה עליו, לא מצב עבודה. **המלצה:** Sentry על המחרוזת `[pdf] signing failed`.

### דברים שצריך לדעת לפני ההחלה

- `COLUMN_ENCRYPTION_KEY` חייב להיות מוגדר ב-Vercel (הוא כבר קיים לטובת טוקני רשות המסים). בלעדיו כל חתימה נכשלת.
- הטבלה `business_signing_keys` בלי שום policy: רק service role. `document_signatures`: SELECT לבעלים, כתיבה רק ל-service role, טריגר שמונע UPDATE לכולם ו-DELETE לכל מי שאינו service role.
- ה-bucket `signed-documents` פרטי, בלי policies על `storage.objects`. הקבצים נמסרים רק דרך המסלולים שלנו.
- אין שינוי ב-`enforce_document_immutability()` ולא ב-`documents`.
- מפתח שהוחלף (rotation) לא קיים עדיין. תעודה תוקפה 5 שנים; לפני פקיעה צריך מנגנון חידוש. רשום כפער ידוע.
- החתימה היא של העסק, נוצרת ומוחזקת בשרת שלנו. "בשליטתו הבלעדית" (חוק חתימה אלקטרונית) מתקיים במובן שאף משתמש אחר ואף לקוח לא יכולים לחתום בשמו; זה אותו מודל של מורנינג. רואה החשבון צריך לאשר את הפרשנות (החלטה 5.1).

## מה נשאר לשלב 3

H (גיבוי למשתמש + ספר לקוחות), I (תעודת רישום בתוך האפליקציה), תדריך לרואה החשבון על 5.1-5.4, עדכון חבילת הרישום. ההגשה למרשם (A) רק אחרי אישור אסף.
