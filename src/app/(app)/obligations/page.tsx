import { redirect } from 'next/navigation'

// The obligations register is now a view inside the intelligence section,
// where it can show a deadline's derivation alongside it. Redirect rather
// than 404 -- the old path is in browser histories and bookmarks.
export default function ObligationsPage() {
  redirect('/intelligence?view=obligations')
}
