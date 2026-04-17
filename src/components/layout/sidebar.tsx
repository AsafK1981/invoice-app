"use client";

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
} from "lucide-react";
import { useBusiness } from "@/lib/business-store";

const navItems = [
  { href: "/dashboard", label: "דשבורד", icon: LayoutDashboard },
  { href: "/documents", label: "מסמכים", icon: FileText },
  { href: "/clients", label: "לקוחות", icon: Users },
  { href: "/products", label: "מוצרים ושירותים", icon: Package },
  { href: "/expenses", label: "הוצאות", icon: Wallet },
  { href: "/reports", label: "דו״חות", icon: TrendingUp },
  { href: "/settings", label: "הגדרות", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { business } = useBusiness();

  return (
    <aside className="w-64 bg-white/80 backdrop-blur-sm border-l border-orange-100 flex flex-col">
      <div className="px-6 py-6 border-b border-orange-100">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-400 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-stone-900">חשבוניות</h1>
            <p className="text-xs text-stone-600 truncate">{business.name}</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                isActive
                  ? "bg-gradient-to-l from-orange-100 to-amber-50 text-orange-700 shadow-sm"
                  : "text-stone-900 hover:bg-orange-50/70 hover:text-orange-700"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-orange-500" : "text-stone-600"}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-orange-100 text-xs text-stone-400">
        גרסה 0.1 · מצב פיתוח
      </div>
    </aside>
  );
}
