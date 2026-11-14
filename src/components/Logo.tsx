export default function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className={small ? 'h-7 w-7' : 'h-9 w-9'}>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#101512" stroke="#3ddc84" strokeWidth="1.5" />
        <path d="M9 20a7 7 0 0 1 14 0z" fill="#3ddc84" />
        <circle cx="13" cy="17" r="1" fill="#101512" />
        <circle cx="19" cy="17" r="1" fill="#101512" />
        <path d="M11 11.5l1.6 2.4M21 11.5l-1.6 2.4" stroke="#3ddc84" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="8" y="22" width="16" height="2.5" rx="1" fill="#ffb547" />
      </svg>
      <div className="leading-none">
        <div className={`font-display font-bold tracking-tight ${small ? 'text-base' : 'text-lg'}`}>APK<span className="text-droid">Forge</span></div>
        {!small && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">gradle build hub</div>}
      </div>
    </div>
  );
}
