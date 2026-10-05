// Built using Hyperiux Vault: https://vault.hyperiux.com

"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import gsap from "gsap";
import "./interactive-list-preview.css";
export interface InteractiveListItem {
  client: string;
  platform?: string;
  services: string;
  img: string;
  data?: unknown;
}

export interface InteractiveListPreviewProps {
  items?: InteractiveListItem[];
  /** Scale multiplier for the hover preview image. */
  imageSize?: number;
  /** Preview image reveal / hide duration (seconds). */
  duration?: number;
  /** Highlight bar + row text transition smoothing (seconds). */
  smoothness?: number;
  /** Pointer-follow smoothing; higher tracks faster. */
  lerp?: number;
  /** Background color of the list surface. */
  bgColor?: string;
  className?: string;
  /** Optional click handler for list items */
  onItemClick?: (item: InteractiveListItem, index: number) => void;
  /** Optional custom action triggers */
  onOpenFinder?: (projectName: string) => void;
  onDeleteProject?: (projectName: string) => void;
}

const DEFAULT_IMAGE_Z_INDEX = 10;
const DEFAULT_IMAGE_SIZE = 1;
const DEFAULT_DURATION = 0.6;
const DEFAULT_SMOOTHNESS = 0.35;
const DEFAULT_LERP = 0.18;
const DEFAULT_ITEMS: InteractiveListItem[] = [
  { client: "AURORA UI", platform: "NEXT.JS", services: "Motion Design, GSAP, Page Transitions, UI Systems", img: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&h=800&fit=crop" },
  { client: "NEON FLOW", platform: "REACT", services: "Interactive UI, Scroll Animations, Effects Library", img: "https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=600&h=800&fit=crop" },
  { client: "GLASSMORPH", platform: "NEXT.JS", services: "Glass UI, Components, Motion Architecture", img: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&h=800&fit=crop" },
  { client: "VOID SYSTEM", platform: "CUSTOM WEBGL", services: "Shaders, Creative Development, Visual Effects", img: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=600&h=800&fit=crop" },
  { client: "HYPER SCROLL", platform: "FRAMER MOTION", services: "Scroll Storytelling, Motion Systems, Interactions", img: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=600&h=800&fit=crop" },
  { client: "PIXEL GRID", platform: "TAILWIND CSS", services: "Design Systems, UI Engineering, Responsive Layouts", img: "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=600&h=800&fit=crop" },
  { client: "MOTION CORE", platform: "HEADLESS CMS", services: "Reusable Components, Motion Engine, Performance", img: "https://images.unsplash.com/photo-1574169208507-84376144848b?w=600&h=800&fit=crop" },
  { client: "INTERFACE X", platform: "NEXT.JS", services: "Immersive UI, Creative Coding, Transitions, Effects", img: "https://images.unsplash.com/photo-1604076913837-52ab5f0e2f20?w=600&h=800&fit=crop" },
  { client: "HYPERIUX", platform: "UI LIBRARY", services: "Animations, Interactive Components, Futuristic Experiences", img: "https://images.unsplash.com/photo-1549490349-8643362247b5?w=600&h=800&fit=crop" },
];

const BASE_IMAGE_WIDTH_REM = 19.5;
const BASE_IMAGE_HEIGHT_REM = 22.5;
const IMAGE_OFFSET_MULTIPLIER = 20;
const ACTIVE_ROW_TEXT_COLOR = "#000000";
const INACTIVE_ROW_TEXT_COLOR = "#ffffff";
const IMAGE_HIDDEN_CLIP_PATH = "inset(50%)";
const IMAGE_VISIBLE_CLIP_PATH = "inset(0%)";
const IMAGE_VISIBILITY_HIDDEN = "hidden";
const IMAGE_VISIBILITY_VISIBLE = "visible";

function clampNumber(value: number, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export default function InteractiveListPreview({
  items = DEFAULT_ITEMS,
  imageSize = DEFAULT_IMAGE_SIZE,
  duration = DEFAULT_DURATION,
  smoothness = DEFAULT_SMOOTHNESS,
  lerp = DEFAULT_LERP,
  bgColor = "transparent",
  className = "",
  onItemClick,
  onOpenFinder,
  onDeleteProject,
}: InteractiveListPreviewProps) {
  const imageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const pendingLeaveRef = useRef<Record<number, boolean>>({});
  const tweenGenerationRef = useRef<Record<number, number>>({});
  const activeIndexRef = useRef<number | null>(null);
  const zIndexRef = useRef(DEFAULT_IMAGE_Z_INDEX);
  const pointerTargetRef = useRef({ x: 0, y: 0 });
  const pointerCurrentRef = useRef({ x: 0, y: 0 });
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const reduceMotionRef = useRef(
    typeof window !== "undefined" &&
      (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false)
  );
  const safeImageSize = clampNumber(imageSize, 0.5, 2, DEFAULT_IMAGE_SIZE);
  const safeDuration = clampNumber(duration, 0.1, 2, DEFAULT_DURATION);
  const safeSmoothness = clampNumber(smoothness, 0.05, 1.5, DEFAULT_SMOOTHNESS);
  const safeLerp = clampNumber(lerp, 0.02, 1, DEFAULT_LERP);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;

    const onChange = (event: MediaQueryListEvent) => {
      reduceMotionRef.current = event.matches;
      if (event.matches && imageContainerRef.current) {
        gsap.killTweensOf(imageContainerRef.current);
        gsap.set(imageContainerRef.current, { x: 0, y: 0 });
        pointerTargetRef.current = { x: 0, y: 0 };
        pointerCurrentRef.current = { x: 0, y: 0 };
      }
    };

    reduceMotionRef.current = mq.matches;
    if (mq.matches && imageContainerRef.current) {
      gsap.set(imageContainerRef.current, { x: 0, y: 0 });
      pointerTargetRef.current = { x: 0, y: 0 };
      pointerCurrentRef.current = { x: 0, y: 0 };
    }
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      const imageContainer = imageContainerRef.current;

      if (imageContainer && !reduceMotionRef.current) {
        const current = pointerCurrentRef.current;
        const target = pointerTargetRef.current;

        current.x += (target.x - current.x) * safeLerp;
        current.y += (target.y - current.y) * safeLerp;

        gsap.set(imageContainer, {
          x: current.x,
          y: current.y,
        });
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [safeLerp]);

  useEffect(() => {
    imageRefs.current.forEach((imageElement) => {
      if (!imageElement) return;

      if (reduceMotionRef.current) {
        gsap.set(imageElement, {
          clipPath: IMAGE_VISIBLE_CLIP_PATH,
          opacity: 0,
          visibility: IMAGE_VISIBILITY_HIDDEN,
        });
      } else {
        gsap.set(imageElement, {
          clipPath: IMAGE_HIDDEN_CLIP_PATH,
          visibility: IMAGE_VISIBILITY_HIDDEN,
        });
      }
    });

    if (!highlightRef.current) return;

    gsap.set(highlightRef.current, {
      opacity: 0,
      y: 0,
      height: 0,
    });
  }, []);

  const setRowTextColor = (index: number, color: string) => {
    const rowElement = rowRefs.current[index];

    if (!rowElement) return;

    gsap.to(rowElement.querySelectorAll("td"), {
      color,
      duration: safeSmoothness,
      ease: "power2.out",
      overwrite: "auto",
    });
  };

  const moveHighlightToRow = (rowElement: HTMLTableRowElement | null) => {
    const tableElement = tableRef.current;
    const highlightElement = highlightRef.current;

    if (!tableElement || !highlightElement || !rowElement) return;

    const tableBounds = tableElement.getBoundingClientRect();
    const rowBounds = rowElement.getBoundingClientRect();

    gsap.to(highlightElement, {
      y: rowBounds.top - tableBounds.top,
      height: rowBounds.height,
      opacity: 1,
      duration: safeSmoothness,
      ease: "power3.out",
      overwrite: "auto",
    });
  };

  const animateImageOut = (index: number) => {
    const imageElement = imageRefs.current[index];

    if (!imageElement) return;

    const nextGen = (tweenGenerationRef.current[index] || 0) + 1;
    tweenGenerationRef.current[index] = nextGen;
    const reduceMotion = reduceMotionRef.current;

    gsap.killTweensOf(imageElement);

    gsap.to(imageElement, {
      ...(reduceMotion
        ? { opacity: 0 }
        : { clipPath: IMAGE_HIDDEN_CLIP_PATH, opacity: 0 }),
      duration: reduceMotion ? Math.min(safeSmoothness, 0.35) : safeDuration,
      ease: reduceMotion ? "power2.out" : "power3.inOut",
      onComplete: () => {
        if (tweenGenerationRef.current[index] !== nextGen) return;

        gsap.set(imageElement, {
          visibility: IMAGE_VISIBILITY_HIDDEN,
        });
      },
    });
  };

  const onRowEnter = (rowElement: HTMLTableRowElement, index: number) => {
    const imageElement = imageRefs.current[index];

    if (!imageElement) return;

    const reduceMotion = reduceMotionRef.current;
    const previousIndex = activeIndexRef.current;

    pendingLeaveRef.current[index] = false;
    rowRefs.current[index] = rowElement;

    if (reduceMotion && previousIndex !== null && previousIndex !== index) {
      pendingLeaveRef.current[previousIndex] = false;
      animateImageOut(previousIndex);
    }

    zIndexRef.current += 1;

    const nextGen = (tweenGenerationRef.current[index] || 0) + 1;
    tweenGenerationRef.current[index] = nextGen;

    gsap.killTweensOf(imageElement);

    if (reduceMotion) {
      gsap.set(imageElement, {
        zIndex: zIndexRef.current,
        visibility: IMAGE_VISIBILITY_VISIBLE,
        clipPath: IMAGE_VISIBLE_CLIP_PATH,
        opacity: 0,
      });

      gsap.to(imageElement, {
        opacity: 1,
        duration: Math.min(safeSmoothness, 0.35),
        ease: "power2.out",
        onComplete: () => {
          if (tweenGenerationRef.current[index] !== nextGen) return;
          if (!pendingLeaveRef.current[index]) return;

          pendingLeaveRef.current[index] = false;
          animateImageOut(index);
        },
      });
    } else {
      gsap.set(imageElement, {
        zIndex: zIndexRef.current,
        visibility: IMAGE_VISIBILITY_VISIBLE,
        clipPath: IMAGE_HIDDEN_CLIP_PATH,
        opacity: 1,
      });

      gsap.to(imageElement, {
        clipPath: IMAGE_VISIBLE_CLIP_PATH,
        opacity: 1,
        duration: safeDuration,
        ease: "power2.inOut",
        onComplete: () => {
          if (tweenGenerationRef.current[index] !== nextGen) return;
          if (!pendingLeaveRef.current[index]) return;

          pendingLeaveRef.current[index] = false;
          animateImageOut(index);
        },
      });
    }

    if (previousIndex !== null && previousIndex !== index) {
      setRowTextColor(previousIndex, INACTIVE_ROW_TEXT_COLOR);
    }

    activeIndexRef.current = index;

    setRowTextColor(index, ACTIVE_ROW_TEXT_COLOR);
    moveHighlightToRow(rowElement);
  };

  const onRowLeave = (index: number) => {
    const imageElement = imageRefs.current[index];

    if (!imageElement) return;

    if (gsap.isTweening(imageElement)) {
      pendingLeaveRef.current[index] = true;
      return;
    }

    animateImageOut(index);
  };

  const onTableLeave = () => {
    if (activeIndexRef.current !== null) {
      setRowTextColor(activeIndexRef.current, INACTIVE_ROW_TEXT_COLOR);
      activeIndexRef.current = null;
    }

    if (!highlightRef.current) return;

    gsap.to(highlightRef.current, {
      opacity: 0,
      duration: safeSmoothness,
      ease: "power2.out",
      overwrite: "auto",
    });

    pointerTargetRef.current = { x: 0, y: 0 };
  };

  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (reduceMotionRef.current) return;
    if (!imageContainerRef.current) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    pointerTargetRef.current = {
      x: x * IMAGE_OFFSET_MULTIPLIER,
      y: y * IMAGE_OFFSET_MULTIPLIER,
    };
  };

  return (
    <>
      {!isCoarsePointer && (
        <div
          style={{ backgroundColor: bgColor }}
          className={`ilp-container relative w-full overflow-hidden font-mono text-white ${className}`}
          onMouseMove={onMouseMove}
        >
          {/* Animated sliding highlight bar */}
          <div
            ref={highlightRef}
            className="ilp-highlight pointer-events-none absolute inset-x-0 top-0 z-10 bg-white"
          />
          {/* Floating Hover Image Preview Container with Difference Blend Mode */}
          <div
            ref={imageContainerRef}
            className="ilp-image-container pointer-events-none absolute inset-0 z-20"
            style={{ mixBlendMode: "difference" }}
          >
            {items.map((item: InteractiveListItem, index: number) => (
              <div
                key={`${item.client}-${index}`}
                ref={(element) => {
                  imageRefs.current[index] = element;
                }}
                className="ilp-image-box invisible absolute left-[40%] top-1/2 h-80 w-64 -translate-y-1/2"
                style={{
                  width: `${BASE_IMAGE_WIDTH_REM * safeImageSize}rem`,
                  height: `${BASE_IMAGE_HEIGHT_REM * safeImageSize}rem`,
                  willChange: "clip-path, opacity",
                  zIndex: DEFAULT_IMAGE_Z_INDEX,
                }}
              >
                <img
                  src={item.img}
                  alt={item.client}
                  className="ilp-image absolute inset-0 h-full w-full object-cover"
                />
              </div>
            ))}
          </div>

          <div
            ref={tableRef}
            className="ilp-table-wrap relative w-full"
            onMouseLeave={onTableLeave}
          >
            <table className="ilp-table relative z-30 w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: "32%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "32%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>

              <tbody>
                {items.map((item: InteractiveListItem, index: number) => (
                  <tr
                    key={`${item.client}-${index}`}
                    className="ilp-row cursor-pointer transition-colors duration-150"
                    onClick={() => onItemClick?.(item, index)}
                    onMouseEnter={(event) =>
                      onRowEnter(event.currentTarget, index)
                    }
                    onMouseLeave={() => onRowLeave(index)}
                  >
                    <td className="ilp-cell ilp-cell--client whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">
                      {item.client}
                    </td>

                    <td className="ilp-cell ilp-cell--platform whitespace-nowrap px-4 py-2.5 text-xs uppercase tracking-wider text-neutral-400">
                      {item.platform}
                    </td>

                    <td className="ilp-cell ilp-cell--services whitespace-nowrap px-4 py-2.5 text-xs tracking-wider text-neutral-400">
                      {item.services}
                    </td>

                    <td className="ilp-cell ilp-cell--actions whitespace-nowrap px-4 py-2.5 text-right text-xs">
                      <div className="ilp-actions-group flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {onOpenFinder && (
                          <button
                            type="button"
                            className="ilp-action-btn inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/5 text-white/60 transition-colors hover:bg-white/15 hover:text-white"
                            title="Reveal in Finder"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                          </button>
                        )}
                        {onDeleteProject && (
                          <button
                            type="button"
                            className="ilp-action-btn ilp-action-btn--delete inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-red-500/30 hover:bg-red-500/15 hover:text-red-400"
                            title="Delete project"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                <tr>
                  <td colSpan={4} className="p-0" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isCoarsePointer && (
        <div style={{ backgroundColor: bgColor }} className={`w-full font-mono text-white ${className}`}>
          {items.map((item: InteractiveListItem, index: number) => (
            <div
              key={`${item.client}-${index}`}
              className="flex cursor-pointer border-b border-white/10 transition-colors hover:bg-white/5"
              onClick={() => onItemClick?.(item, index)}
            >
              <div className="flex w-1/2 flex-col justify-between gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <p className="font-bold uppercase tracking-widest text-sm">
                    {item.client}
                  </p>

                  {item.platform && (
                    <p className="text-xs uppercase tracking-widest text-white/60">
                      {item.platform}
                    </p>
                  )}

                  <p className="text-xs leading-relaxed text-white/50">
                    {item.services}
                  </p>
                </div>
              </div>

              <div className="relative aspect-3/4 h-full w-1/2 max-[1025px]:h-[30vh]">
                <img
                  src={item.img}
                  alt={item.client}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
