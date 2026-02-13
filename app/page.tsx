"use client";

import dynamic from "next/dynamic";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const CanvasEditor = dynamic(
  () => import("@/components/CanvasEditor").then((m) => m.CanvasEditor),
  {
    ssr: false,
  },
);

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [photosLoading, setPhotosLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  const showLoader = loading || (!!user && photosLoading);

  if (!loading && !user) {
    return null;
  }

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {showLoader && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">
            Loading photos...
          </span>
        </div>
      )}
      {user && <CanvasEditor onPhotosLoadStateChange={setPhotosLoading} />}
    </div>
  );
}
