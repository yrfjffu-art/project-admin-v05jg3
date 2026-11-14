import { useRef, useState, type DragEvent } from 'react';
import { FileArchive, UploadCloud } from 'lucide-react';

export const MAX_ZIP = 50 * 1024 * 1024;

export default function ZipDrop({ onFile, compact }: { onFile: (f: File) => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onClick={() => ref.current?.click()}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed text-center transition ${compact ? 'p-6' : 'p-10'} ${over ? 'border-droid bg-droid/5' : 'border-line hover:border-droid/50 hover:bg-panel2/50'}`}
    >
      <input ref={ref} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-droid/10 text-droid">
        {over ? <FileArchive className="h-6 w-6" /> : <UploadCloud className="h-6 w-6" />}
      </div>
      <div className="font-display font-semibold">Drop your Android project .zip</div>
      <div className="mt-1 text-sm text-mute">or click to browse · max 50 MB · exclude build/ and .gradle/ folders</div>
    </div>
  );
}
