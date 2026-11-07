import { ExternalLink } from 'lucide-react'
import { brand } from '../lib/brand.js'
import { SOURCES } from '../lib/sources.js'

// Sources & Licences — the plain list of every dataset and service
// the app ships (data: src/lib/sources.js, grounded in the build
// manifests and the code). Deliberately a list, not cards: one
// accent, the licence on every entry, a link where one exists.
export default function SourcesView() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Sources &amp; Licences</h2>
        <p className="text-sm text-slate-400 mt-1">
          {brand.name} is built on open dictionaries and two online voice services. If it is listed here, the app ships it or calls it; if it is not listed, the app does not use it.
        </p>
      </div>

      <div className="space-y-6">
        {SOURCES.map((s) => (
          <section key={s.name} className="space-y-1">
            <h3 className="text-lg font-bold text-white">{s.name}</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{s.usedFor}</p>
            <p className="text-xs text-slate-500">{s.licence}</p>
            {s.credit && <p className="text-xs text-slate-400 leading-relaxed">{s.credit}</p>}
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[#FF8A75] hover:underline">
                {s.url.replace(/^https?:\/\//, '')} <ExternalLink size={13} />
              </a>
            )}
          </section>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Derived data is labelled where it is derived: the sound-component signal and the component index are computed from the sources above by the build scripts, and the attested sound families name both sources that confirm them.
      </p>
    </div>
  )
}
