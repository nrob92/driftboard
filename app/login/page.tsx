'use client';

import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();

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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#3ECF8E]/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#3ECF8E]/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 bg-[#171717] border border-[#2a2a2a] rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl shadow-black/50">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#0d0d0d]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome to Driftboard</h1>
          <p className="text-[#888]">Photo editing made simple</p>
        </div>

        {/* Features */}
        <div className="space-y-3 mb-8">
          <div className="flex items-center gap-3 text-[#ccc]">
            <div className="w-5 h-5 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-[#3ECF8E]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm">Infinite canvas with zoom & pan</span>
          </div>
          <div className="flex items-center gap-3 text-[#ccc]">
            <div className="w-5 h-5 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-[#3ECF8E]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm">Edit brightness, contrast, filters</span>
          </div>
          <div className="flex items-center gap-3 text-[#ccc]">
            <div className="w-5 h-5 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-[#3ECF8E]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm">Cloud storage with Supabase</span>
          </div>
          <div className="flex items-center gap-3 text-[#ccc]">
            <div className="w-5 h-5 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-[#3ECF8E]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm">Add text overlays</span>
          </div>
        </div>

        {/* Google Sign In Button */}
        <button
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-medium py-3 px-4 rounded-xl transition-all duration-150 shadow-lg shadow-black/20 hover:shadow-xl hover:shadow-black/30"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Footer */}
        <p className="text-center text-[#555] text-xs mt-6">
          By signing in, you agree to our terms of service
        </p>
      </div>
    </div>
  );
}
