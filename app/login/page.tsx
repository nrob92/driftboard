'use client';

import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const LoginSandbox = dynamic(() => import('@/components/LoginSandbox').then((m) => m.LoginSandbox), { ssr: false });

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const signInSectionRef = useRef<HTMLDivElement>(null);
  const sandboxSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && !loading) {
      router.push('/');
    }
  }, [user, loading, router]);

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Failed to sign in:', error);
    }
  };

  const scrollToSandbox = () => sandboxSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const scrollToSignIn = () => signInSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] relative overflow-auto">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(ellipse_80%_50%_at_50%_-20%,rgba(62,207,142,0.08),transparent)]" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#3ECF8E]/20 to-transparent" />
        <div className="absolute -top-40 -right-40 w-[32rem] h-[32rem] bg-[#3ECF8E]/6 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 -left-32 w-96 h-96 bg-[#3ECF8E]/4 rounded-full blur-[80px]" />
        <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-[#3ECF8E]/5 rounded-full blur-[90px]" />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(#3ECF8E 1px, transparent 1px), linear-gradient(90deg, #3ECF8E 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative z-10">
        {/* Nav */}
        <header className="sticky top-0 z-20 border-b border-[#2a2a2a]/80 bg-[#0d0d0d]/80 backdrop-blur-xl">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center">
                <svg className="w-4 h-4 text-[#0d0d0d]" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                </svg>
              </div>
              <span className="font-semibold text-white">Driftboard</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={scrollToSandbox}
                className="text-sm text-[#888] hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-[#252525]"
              >
                Try it
              </button>
              <button
                type="button"
                onClick={scrollToSignIn}
                className="text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] px-4 py-2 rounded-lg transition-colors"
              >
                Get started
              </button>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-5xl mx-auto px-4 pt-16 pb-20 text-center">
          <p className="text-[#3ECF8E] text-sm font-medium uppercase tracking-widest mb-4">Photo editing on an infinite canvas</p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight max-w-3xl mx-auto leading-[1.1]">
            Edit photos the way you think.
          </h1>
          <p className="text-[#888] text-lg sm:text-xl mt-6 max-w-xl mx-auto">
            Curves, light, color, and effects—all on a canvas that grows with you. No subscriptions, no lock-in.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
            <button
              type="button"
              onClick={scrollToSandbox}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#171717] border border-[#2a2a2a] text-white font-medium hover:border-[#3ECF8E]/50 hover:bg-[#252525] transition-all"
            >
              <svg className="w-5 h-5 text-[#3ECF8E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Try it free
            </button>
            <button
              type="button"
              onClick={scrollToSignIn}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#3ECF8E] text-[#0d0d0d] font-medium hover:bg-[#35b87d] transition-colors"
            >
              Continue with Google
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          </div>
        </section>

        {/* Sandbox — Try it */}
        <section ref={sandboxSectionRef} className="max-w-4xl mx-auto px-4 py-16" aria-label="Try the canvas">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white">Try it in your browser</h2>
            <p className="text-[#888] mt-2">Drop up to 3 photos and use the same tools as the full app. No sign-up required.</p>
          </div>
          <LoginSandbox signInSectionRef={signInSectionRef} />
        </section>

        {/* Features */}
        <section className="max-w-5xl mx-auto px-4 py-20">
          <h2 className="text-2xl font-bold text-white text-center mb-12">Why Driftboard</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                ),
                title: 'Infinite canvas',
                desc: 'Zoom, pan, and arrange as many photos as you need. No fixed frame.',
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 20 C 8 20, 8 4, 12 4 C 16 4, 16 20, 20 20" />
                  </svg>
                ),
                title: 'Curves & light',
                desc: 'Full control: curves, exposure, contrast, highlights, shadows, whites, and blacks.',
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                ),
                title: 'Color & effects',
                desc: 'Temperature, vibrance, saturation, clarity, dehaze, vignette, and grain.',
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                ),
                title: 'Export & save',
                desc: 'Export with all edits baked in. Your projects stored in the cloud.',
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                ),
                title: 'Presets',
                desc: 'Import .xmp presets and save your own. One-click style transfer.',
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ),
                title: 'Text & overlays',
                desc: 'Add text to your boards. Font size and color, drag to place.',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl bg-[#171717] border border-[#2a2a2a] hover:border-[#3ECF8E]/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#3ECF8E]/10 text-[#3ECF8E] flex items-center justify-center mb-4">
                  {item.icon}
                </div>
                <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-[#888] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Sign in CTA */}
        <section ref={signInSectionRef} className="max-w-5xl mx-auto px-4 py-20">
          <div className="max-w-md mx-auto">
            <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl p-8 shadow-2xl shadow-black/30">
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-[#0d0d0d]" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white">Get started free</h2>
                <p className="text-[#888] text-sm mt-1">Sign in with Google to save and export your work.</p>
              </div>

              <button
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-medium py-3 px-4 rounded-xl transition-all duration-150 shadow-lg shadow-black/20 hover:shadow-xl hover:shadow-black/30"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <p className="text-center text-[#555] text-xs mt-6">
                By signing in, you agree to our terms of service.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-[#2a2a2a] py-8">
          <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#3ECF8E]/20 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-[#3ECF8E]" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                </svg>
              </div>
              <span className="text-sm text-[#666]">Driftboard</span>
            </div>
            <p className="text-xs text-[#555]">Photo editing on an infinite canvas.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
