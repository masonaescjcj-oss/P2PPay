import { useAuth } from '../lib/auth.jsx'
import { usePrefs } from '../lib/prefs.jsx'
import { faq, privacy, terms } from '../content/legal.js'

const DOCS = { terms, privacy }

// Terms or privacy text, sectioned. Used on its own page and inside the sign-up sheet.
export function LegalText({ doc }) {
  const { lang } = usePrefs()
  const { config } = useAuth()
  return (
    <div className="legal">
      {DOCS[doc](config, lang).map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p?.map((p) => <p key={p}>{p}</p>)}
          {s.list && <ul>{s.list.map((li) => <li key={li}>{li}</li>)}</ul>}
        </section>
      ))}
    </div>
  )
}

export function Faq() {
  const { lang } = usePrefs()
  const { config } = useAuth()
  return (
    <div className="faq">
      {faq(config, lang).map((f) => (
        <details key={f.q} className="card">
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  )
}
