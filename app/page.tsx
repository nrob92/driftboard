'use client';

import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const CanvasEditor = dynamic(() => import('@/components/CanvasEditor').then((m) => m.CanvasEditor), {
  ssr: false,
});

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <CanvasEditor />
    </div>
  );
}
