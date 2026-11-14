import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Terminal } from 'lucide-react';
import supabase from '../lib/supabase';
import { signInWithGoogle } from '../lib/googleAuth';
import { useAuth } from '../contexts/AuthContext';
import Logo from '../components/Logo';

export default function Login() {
  const { user } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setInfo('Account created. Check your inbox to confirm, then sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-line p-12 lg:flex lg:flex-col lg:justify-between">
        <Logo />
        <div>
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight">
            Zip in.<br /><span className="text-droid">APK out.</span>
          </h1>
          <p className="mt-5 max-w-md text-mute">Upload an Android Studio project, pick your JDK, SDK platform and Gradle, then let your own build agents compile it — logs streamed live.</p>
          <div className="term mt-10 max-w-md p-5 text-[12.5px] leading-6">
            {[
              ['$', 'node apk-agent.mjs --token fa_••••'],
              ['>', 'Task :app:compileDebugKotlin'],
              ['>', 'Task :app:mergeDebugResources'],
              ['>', 'Task :app:packageDebug'],
              ['✔', 'BUILD SUCCESSFUL in 48s'],
            ].map(([p, t], i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.35 }}>
                <span className={p === '✔' ? 'text-droid' : 'text-amber'}>{p}</span> <span className={p === '✔' ? 'text-droid' : 'text-ink/80'}>{t}</span>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="font-mono text-xs text-mute">JDK · Android SDK · Build Tools · Gradle · NDK</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="font-display text-2xl font-bold">{isSignUp ? 'Create your forge' : 'Welcome back'}</h2>
          <p className="mt-1 text-sm text-mute">{isSignUp ? 'Sign up to start building APKs.' : 'Sign in to your build hub.'}</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.dev" />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && <div className="text-sm text-danger">{error}</div>}
            {info && <div className="text-sm text-droid">{info}</div>}
            <button className="btn btn-primary w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-mute"><div className="h-px flex-1 bg-line" />or<div className="h-px flex-1 bg-line" /></div>
          <button onClick={() => signInWithGoogle('APK Forge')} className="btn btn-ghost w-full">
            <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" /></svg>
            Continue with Google
          </button>

          <p className="mt-6 text-center text-sm text-mute">
            {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
            <button onClick={() => { setIsSignUp(!isSignUp); setError(''); setInfo(''); }} className="text-droid hover:underline">
              {isSignUp ? 'Sign in' : 'Create one'}
            </button>
          </p>
          <div className="mt-8 flex items-center gap-2 rounded-lg border border-line bg-panel p-3 font-mono text-xs text-mute">
            <Terminal className="h-4 w-4 text-amber" /> demo@apkforge.dev / password123
          </div>
        </motion.div>
      </div>
    </div>
  );
}
