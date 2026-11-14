import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Analysis } from '../lib/analyze';

export default function AnalysisPanel({ a }: { a: Analysis }) {
  const rows: [string, string | number | null | undefined][] = [
    ['App module', a.appModule === '' ? '(root)' : a.appModule],
    ['Application ID', a.applicationId],
    ['Namespace', a.namespace],
    ['compileSdk', a.compileSdk],
    ['minSdk / targetSdk', a.minSdk || a.targetSdk ? `${a.minSdk ?? '?'} / ${a.targetSdk ?? '?'}` : null],
    ['AGP', a.agpVersion],
    ['Gradle wrapper', a.gradleVersion ?? (a.hasWrapper ? 'present' : 'missing')],
    ['Java target', a.javaVersion],
    ['Build DSL', a.dsl === 'kotlin' ? 'Kotlin (.kts)' : a.dsl === 'groovy' ? 'Groovy' : null],
    ['Language', a.kotlin ? 'Kotlin' : 'Java'],
    ['Recommended JDK', a.recommendedJdk],
    ['Files', a.fileCount],
  ];
  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2 text-sm ${a.isAndroid ? 'text-droid' : 'text-amber'}`}>
        {a.isAndroid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {a.isAndroid ? 'Android application project detected' : 'Could not confirm an Android app module'}
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="bg-panel px-3 py-2.5">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-mute">{k}</dt>
            <dd className="mt-0.5 truncate font-mono text-sm">{v ?? <span className="text-mute">—</span>}</dd>
          </div>
        ))}
      </dl>
      {a.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {a.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-xs text-amber"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
