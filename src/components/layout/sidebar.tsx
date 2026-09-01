"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Wallet,
  TrendingUp,
  Settings,
  Sparkles,
  LogOut,
  Menu,
  X,
  User,
  RefreshCw,
  Bug,
  MessageCircle,
  ShieldAlert,
  Landmark,
  Bell,
  CalendarClock,
  Globe,
  Import,
  Palette,
  Type,
} from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import {
  TEXT_SIZE_EVENT,
  applyStoredTextSize,
  readTextSize,
  setTextSize,
  syncTextSizeFromBusiness,
  type TextSize,
} from "@/lib/text-size";
import { signOut } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import { AccountSettingsModal } from "@/components/account-settings-modal";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import type { FeatureTone } from "@/lib/feature-tones";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Feature tone for the rest-state icon tile; omit to keep the neutral
   * stone tile + gold hover (חשבונית ישראל keeps the gold treatment). */
  tone?: FeatureTone;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "ראשי", icon: LayoutDashboard, tone: "amber" },
  { href: "/documents", label: "מסמכים", icon: FileText, tone: "indigo" },
  { href: "/clients", label: "לקוחות", icon: Users, tone: "teal" },
  { href: "/products", label: "מוצרים ושירותים", icon: Package, tone: "violet" },
  { href: "/expenses", label: "הוצאות", icon: Wallet, tone: "pink" },
  { href: "/recurring", label: "חיובים חוזרים", icon: RefreshCw, tone: "sky" },
  { href: "/notifications", label: "התראות", icon: Bell, tone: "orange" },
  { href: "/reminders", label: "תזכורות", icon: CalendarClock, tone: "orange" },
  { href: "/reports", label: "דו״חות", icon: TrendingUp, tone: "emerald" },
  // A first-time user who arrives from Invoice4U / Morning / iCount looks for
  // "where do I bring my data in" before anything else, and used to find it
  // only as a small button inside /documents (2026-08-25: one watched a new
  // user hunt for it). So the migration guide gets its own tab, right where
  // the one-time setup tasks live, just above settings.
  { href: "/migrate", label: "מעבר מתוכנה אחרת", icon: Import, tone: "emerald" },
  // Document design was a card buried inside /settings; Asaf (2026-08-25)
  // wanted it as its own tab, separate from settings.
  { href: "/design", label: "עיצוב מסמך", icon: Palette, tone: "pink" },
  { href: "/settings", label: "הגדרות", icon: Settings, tone: "slate" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { business } = useBusiness();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Show the "/admin" nav item only when the logged-in user's email
  // appears in the admin allow-list. Computed client-side; the API
  // route enforces the same check server-side.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setIsAdmin(isAdminEmail(user?.email));
      })
      // Hide the admin link if we cannot confirm - denying is the safe
      // default, and the routes behind it check permission on their own.
      .catch(() => setIsAdmin(false));
  }, []);
  const [accountOpen, setAccountOpen] = useState(false);

  // "טקסט גדול" (large-text mode). Cached choice applies on mount so a
  // returning user never sees a small-text flash; the business row, once it
  // arrives, is the source of truth and overrides the cache; the switch
  // itself just follows whatever is applied to <html> (via the event), so
  // the desktop sidebar and the mobile drawer can never disagree.
  const [textSize, setTextSizeState] = useState<TextSize>("normal");
  useEffect(() => {
    applyStoredTextSize();
    setTextSizeState(readTextSize());
    const onChange = () => setTextSizeState(readTextSize());
    window.addEventListener(TEXT_SIZE_EVENT, onChange);
    return () => window.removeEventListener(TEXT_SIZE_EVENT, onChange);
  }, []);
  useEffect(() => {
    if (business.id) syncTextSizeFromBusiness(business.textSize);
  }, [business.id, business.textSize]);

  // Escape closes the mobile drawer, matching the existing backdrop-click handler.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const sidebarContent = (
    <>
      <div className="px-6 py-6 border-b border-orange-100/60">
        <div className="flex items-center gap-3">
          {business.logoUrl ? (
            <div className="w-11 h-11 rounded-2xl bg-white shadow-lg shadow-orange-200/50 overflow-hidden flex items-center justify-center border border-orange-100">
              <img
                src={business.logoUrl}
                alt={business.name}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-400 flex items-center justify-center shadow-lg shadow-orange-200/50 btn-glow">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-stone-900 leading-tight">MyFriendly<br/>InvoiceApp</h1>
            <p className="text-xs text-stone-600 truncate">{business.name}</p>
          </div>
        </div>
      </div>
      {/* No entrance animation on this nav (or the <aside> below): combining
          the sidebar's own transform animation with staggered per-link
          fadeInUp animations left Chromium's compositor painting most links
          blank after the animation settled - computed style read opacity 1
          the whole time, but the pixels stayed empty. Reproduced in both
          headless and headed real Chrome; confirmed fixed by dropping
          `animation` entirely. Primary nav must not be allowed to render
          invisible, so don't re-add stagger/slide-in here. */}
      <nav className="flex-1 p-3 space-y-1">
        {[
          ...navItems,
          // חשבונית ישראל (allocation numbers) only applies to VAT-charging
          // businesses. surface a dedicated, easy-to-find entry for them so
          // connecting isn't buried inside the settings page.
          ...(business?.businessType === "authorized" ||
          business?.businessType === "company"
            ? ([{ href: "/settings#tax-authority", label: "חשבונית ישראל", icon: Landmark }] as NavItem[])
            : []),
          ...(isAdmin
            ? ([{ href: "/admin", label: "ניהול מערכת", icon: ShieldAlert, tone: "rose" }] as NavItem[])
            : []),
        ].map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const tone = item.tone;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-l from-orange-100 to-amber-50 dark:from-orange-900/35 dark:to-amber-900/20 text-orange-700 shadow-sm shadow-orange-100 dark:shadow-orange-950/30"
                  : "text-stone-900 hover:bg-orange-50/80 dark:hover:bg-orange-900/25 hover:text-orange-700 hover:translate-x-[-2px]"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-br from-orange-400 to-rose-400 shadow-sm"
                    : tone
                    ? `ftile ftile-${tone}`
                    : "bg-stone-100 dark:bg-stone-800 group-hover:bg-gradient-to-br group-hover:from-orange-300 group-hover:to-rose-300 dark:group-hover:from-orange-800/70 dark:group-hover:to-rose-800/60"
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors duration-200 ${
                    isActive ? "text-white" : tone ? "" : "text-stone-500 group-hover:text-white"
                  }`}
                />
              </div>
              <span>{item.label}</span>
              {isActive && (
                <div className="mr-auto w-1.5 h-1.5 rounded-full bg-orange-400" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-orange-100/60 space-y-1">
        {/* The app has exactly one look (see app-skin.css), so there is no
            skin toggle and no light/dark toggle here; the coral-era ones
            were removed with the second visual state they switched between. */}
        {/* Beta feedback button: pre-fills a WhatsApp message to Asaf
            with the current page URL so testing friends can report
            something they hit in one tap. The phone number is the
            user's real WhatsApp; if you fork this app, change it. */}
        <a
          href={(() => {
            const PHONE = "972549000684"; // +972 549000684 (international format)
            const where = typeof window !== "undefined" ? window.location.href : "";
            const text = `היי אסף, מצאתי משהו ב-MyFriendlyInvoiceApp:\n\n[תאר כאן את הבעיה]\n\nבעמוד: ${where}`;
            return `https://wa.me/${PHONE}?text=${encodeURIComponent(text)}`;
          })()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
        >
          <Bug className="w-4 h-4" />
          דווח על באג / רעיון
        </a>
        {/* Referral link: pre-fills a WhatsApp message inviting a friend
            to try the app. No fixed recipient - the user picks who to
            send it to from their own WhatsApp contacts. */}
        <a
          href={(() => {
            const text = `היי! אני משתמש באפליקציה MyFriendlyInvoiceApp להוצאת חשבוניות - פשוטה, מהירה וחינמית לעוסק פטור. נראה לי שיכול להתאים לך:\n${CANONICAL_ORIGIN}`;
            return `https://wa.me/?text=${encodeURIComponent(text)}`;
          })()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          הזמן חבר בוואטסאפ
        </a>
        {/* The public landing page. "/" bounces a signed-in visitor straight
            to /dashboard, so this points at /product - the SAME marketing page
            at an address that never redirects. Without it a logged-in user has
            no way to read what the product promises, or to show it to the
            friend they just invited on the line above. Deliberately down here
            and not in navItems: those ten entries are daily work, this is not. */}
        <Link
          href="/product"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
        >
          <Globe className="w-4 h-4" />
          דף הבית של האתר
        </Link>
        <button
          onClick={() => {
            setAccountOpen(true);
            setMobileOpen(false);
          }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
        >
          <User className="w-4 h-4" />
          חשבון משתמש
        </button>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          התנתק
        </button>
        {/* Larger-text switch (Asaf, 2026-08-31; label + extra bump 2026-09-01):
            for people who find the app's text small. One tap lifts the whole app ~17% (html[data-text-size]
            in app-skin.css); the choice is cached locally and saved on the
            business row so it follows them to their other devices. A real
            <button role="switch">, not a checkbox, so screen readers announce
            the state and the whole row is the hit target. */}
        <button
          type="button"
          role="switch"
          aria-checked={textSize === "large"}
          onClick={() => {
            void setTextSize(textSize === "large" ? "normal" : "large", business.id || undefined);
          }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
        >
          <Type className="w-4 h-4" />
          <span className="flex-1 text-start">טקסט גדול יותר</span>
          <span
            aria-hidden="true"
            className={`relative inline-block w-9 h-5 rounded-full transition-colors flex-none ${
              textSize === "large" ? "bg-orange-500" : "bg-stone-300"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                textSize === "large" ? "left-0.5" : "right-0.5"
              }`}
            />
          </span>
        </button>
        {/* Compliance link, not a nav item - kept quiet on purpose (no icon
            tile, no hover background). Same component renders both the
            desktop sidebar and the mobile drawer, so this reaches both. */}
        <Link
          href="/accessibility"
          target="_blank"
          rel="noopener"
          aria-label="הצהרת נגישות (נפתח בכרטיסייה חדשה)"
          onClick={() => setMobileOpen(false)}
          className="flex items-center w-full px-3 min-h-[40px] text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          נגישות
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button. `print:hidden` matters: Chrome lays the
          print page out narrower than `lg`, so without it this fixed button
          was printed onto the top-right corner of every document. */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden print:hidden fixed top-4 right-4 z-40 w-10 h-10 rounded-xl bg-white shadow-md border border-orange-100 flex items-center justify-center text-stone-700 hover:bg-orange-50"
        aria-label="תפריט"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
        className={`lg:hidden fixed inset-y-0 right-0 z-50 w-72 bg-white/95 backdrop-blur-xl flex flex-col shadow-2xl transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 left-4 w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-600 hover:bg-stone-200"
          aria-label="סגור"
        >
          <X className="w-4 h-4" />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      {/* `data-app-sidebar` is the hook for the APP-SHELL DESKTOP SCALE rule in
          app-skin.css (`html:has([data-app-sidebar])`). This <aside> is always
          in the DOM (only hidden by CSS below lg), so the rule matches on every
          app page and never on marketing / auth pages, which have no sidebar. */}
      <aside
        data-app-sidebar
        className="hidden lg:flex print:hidden w-64 bg-white/80 backdrop-blur-xl border-l border-orange-100/60 flex-col"
      >
        {sidebarContent}
      </aside>

      <AccountSettingsModal open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}
