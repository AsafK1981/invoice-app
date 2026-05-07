import Link from "next/link";
import { Compass, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "העמוד לא נמצא · MySuperFriendlyInvoiceApp",
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center px-6">
      <div className="card-soft p-8 sm:p-12 max-w-md w-full text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md">
          <Compass className="w-8 h-8 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-stone-900">404</h1>
          <p className="text-base text-stone-700 mt-2">העמוד שחיפשת לא נמצא.</p>
          <p className="text-sm text-stone-500 mt-1">
            ייתכן שהקישור ישן, או שהקלדת כתובת לא נכונה.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200"
          >
            <ArrowLeft className="w-4 h-4" />
            חזרה לעמוד הבית
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
          >
            לדשבורד
          </Link>
        </div>
      </div>
    </div>
  );
}
