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
  Moon,
  Sun,
  ShieldAlert,
} from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { signOut } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { isAdminEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import { AccountSettingsModal } from "@/components/account-settings-modal";

const navItems = [
  { href: "/dashboard", label: "דשבורד", icon: LayoutDashboard },
  { href: "/documents", label: "מסמכים", icon: FileText },
  { href: "/clients", label: "לקוחות", icon: Users },
  { href: "/products", label: "מוצרים ושירותים", icon: Package },
  { href: "/expenses", label: "הוצאות", icon: Wallet },
  { href: "/recurring", label: "חיובים חוזרים", icon: RefreshCw },
  { href: "/reports", label: "דו״חות", icon: TrendingUp },
  { href: "/settings", label: "הגדרות", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { business } = useBusiness();
  const { theme, toggle: toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Show the "/admin" nav item only when the logged-in user's email
  // appears in the admin allow-list. Computed client-side; the API
  // route enforces the same check server-side.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAdmin(isAdminEmail(user?.email));
    });
  }, []);
  const [accountOpen, setAccountOpen] = useState(false);

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
            <h1 className="text-sm font-bold text-stone-900 leading-tight">MySuperFriendly<br/>InvoiceApp</h1>
            <p className="text-xs text-stone-600 truncate">{business.name}</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {[
          ...navItems,
          ...(isAdmin
            ? [{ href: "/admin", label: "ניהול מערכת", icon: ShieldAlert }]
            : []),
        ].map((item, idx) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 animate-fade-in-up stagger-${idx + 1} ${
                isActive
                  ? "bg-gradient-to-l from-orange-100 to-amber-50 dark:from-orange-900/35 dark:to-amber-900/20 text-orange-700 shadow-sm shadow-orange-100 dark:shadow-orange-950/30"
                  : "text-stone-900 hover:bg-orange-50/80 dark:hover:bg-orange-900/25 hover:text-orange-700 hover:translate-x-[-2px]"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-br from-orange-400 to-rose-400 shadow-sm"
                    : "bg-stone-100 dark:bg-stone-800 group-hover:bg-gradient-to-br group-hover:from-orange-300 group-hover:to-rose-300 dark:group-hover:from-orange-800/70 dark:group-hover:to-rose-800/60"
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors duration-200 ${
                    isActive ? "text-white" : "text-stone-500 group-hover:text-white"
                  }`}
                />
              </div>
              <span>{item.label}</span>
              {isActive && (
                <div className="mr-auto w-1.5 h-1.5 rounded-full bg-orange-400 animate-scale-in" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-orange-100/60 space-y-1">
        {/* Beta feedback button — pre-fills a WhatsApp message to Asaf
            with the current page URL so testing friends can report
            something they hit in one tap. The phone number is the
            user's real WhatsApp; if you fork this app, change it. */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-stone-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
        >
          {theme === "dark" ? (
            <>
              <Sun className="w-4 h-4" />
              עבור למצב בהיר
            </>
          ) : (
            <>
              <Moon className="w-4 h-4" />
              עבור למצב כהה
            </>
          )}
        </button>
        <a
          href={(() => {
            const PHONE = "972549000684"; // +972 549000684 (international format)
            const where = typeof window !== "undefined" ? window.location.href : "";
            const text = `היי אסף, מצאתי משהו ב-MySuperFriendlyInvoiceApp:\n\n[תאר כאן את הבעיה]\n\nבעמוד: ${where}`;
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
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 right-4 z-40 w-10 h-10 rounded-xl bg-white shadow-md border border-orange-100 flex items-center justify-center text-stone-700 hover:bg-orange-50"
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
      <aside className="hidden lg:flex w-64 bg-white/80 backdrop-blur-xl border-l border-orange-100/60 flex-col animate-slide-in-right">
        {sidebarContent}
      </aside>

      <AccountSettingsModal open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}
