import { redirect } from 'next/navigation'

// The risk portfolio is now a view inside the intelligence section. Redirect
// rather than 404: the old path is in browser histories and bookmarks, and
// the destination shows exactly the same portfolio.
export default function RiskPage() {
  redirect('/intelligence?view=risk')
}
