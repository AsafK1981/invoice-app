import Link from "next/link";
import { LtrText } from "@/components/ui/ltr";
import { COMPETITORS, type Competitor } from "@/lib/comparison-data";

/**
 * Links a comparison page to the other five.
 *
 * Before this, the six /vs pages formed a star through the /vs index with no
 * edges between them, so a visitor comparing us to Invoice4U had no path to
 * the SUMIT or iCount comparison without backing out. Derived from COMPETITORS,
 * so a seventh comparison page joins the set with no edit here.
 */
export default function VsSiblings({ current }: { current: Competitor["slug"] }) {
  const others = Object.values(COMPETITORS).filter((c) => c.slug !== current);
  if (others.length === 0) return null;

  return (
    <nav className="v2-vs-siblings" aria-label="השוואות נוספות">
      <div className="v2-eyebrow-row">
        <i className="ln" />
        <span>השוואות נוספות</span>
      </div>
      <ul>
        {others.map((competitor) => (
          <li key={competitor.slug}>
            <Link href={`/vs/${competitor.slug}`}>
              <LtrText text={competitor.name} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
