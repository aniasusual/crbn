"use client";

import InteractiveListPreview from "@/components/ui/interactive-list-preview";

export default function InteractiveListPreviewDemo() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-16 bg-neutral-900 px-4 max-[1025px]:h-auto max-[1025px]:py-16">
      <div className="space-y-3 text-center">
        <h2 className="font-mono text-[4vw] capitalize text-white max-[1025px]:text-4xl">
          Elevating interaction through motion
        </h2>
        <p className="font-mono text-sm text-white/50">Hover the list to see the effect</p>
      </div>

      <InteractiveListPreview />
    </div>
  );
}
