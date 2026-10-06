"use client";

import { ChromaticImage } from "@/components/ui/chromatic-image";

export default function ChromaticImageDemo() {
  return (
    <div className="w-full py-10 sm:py-16">
      <ChromaticImage
        src="https://assets.aceternity.com/screenshots/8131a006-884a-4444-85a6-aee9d56af136.webp"
        alt="A person standing beneath a red light"
        className="mx-auto aspect-[4/5] w-full max-w-sm rounded-[min(1.5vw,18px)] outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      />
    </div>
  );
}
export { ChromaticImageDemo };
