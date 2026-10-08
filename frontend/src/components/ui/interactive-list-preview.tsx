// Built using Hyperiux Vault: https://vault.hyperiux.com

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import "./interactive-list-preview.css";

export interface InteractiveListItem {
  key?: string;
  client: ReactNode;
  platform?: ReactNode;
  services: ReactNode;
  img?: string;
  data?: unknown;
  actions?: ReactNode;
  selected?: boolean;
}

export interface InteractiveListPreviewProps {
  items?: InteractiveListItem[];
  /** Highlight bar transition smoothing (seconds). */
  smoothness?: number;
  /** Background color of the list surface. */
  bgColor?: string;
  className?: string;
  /** Custom column widths for table layout (e.g. ["30%", "22%", "34%", "14%"]) */
  colWidths?: [string, string, string, string];
  /** Optional click handler for list items */
  onItemClick?: (item: InteractiveListItem, index: number) => void;
  /** Optional custom action triggers */
  onOpenFinder?: (projectName: string) => void;
  onDeleteProject?: (projectName: string) => void;
}

const DEFAULT_SMOOTHNESS = 0.25;
const DEFAULT_ITEMS: InteractiveListItem[] = [
  { client: "AURORA UI", platform: "NEXT.JS", services: "Motion Design, GSAP, Page Transitions, UI Systems" },
  { client: "NEON FLOW", platform: "REACT", services: "Interactive UI, Scroll Animations, Effects Library" },
  { client: "GLASSMORPH", platform: "NEXT.JS", services: "Glass UI, Components, Motion Architecture" },
  { client: "VOID SYSTEM", platform: "CUSTOM WEBGL", services: "Shaders, Creative Development, Visual Effects" },
  { client: "HYPER SCROLL", platform: "FRAMER MOTION", services: "Scroll Storytelling, Motion Systems, Interactions" },
];

function clampNumber(value: number, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

const DEFAULT_COL_WIDTHS: [string, string, string, string] = ["32%", "22%", "26%", "20%"];

export default function InteractiveListPreview({
  items = DEFAULT_ITEMS,
  smoothness = DEFAULT_SMOOTHNESS,
  bgColor = "transparent",
  className = "",
  colWidths = DEFAULT_COL_WIDTHS,
  onItemClick,
  onOpenFinder,
  onDeleteProject,
}: InteractiveListPreviewProps) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const activeIndexRef = useRef<number | null>(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  const safeSmoothness = clampNumber(smoothness, 0.05, 1.5, DEFAULT_SMOOTHNESS);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!highlightRef.current) return;
    gsap.set(highlightRef.current, {
      opacity: 0,
      y: 0,
      height: 0,
    });
  }, [items]);

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
      ease: "power2.out",
      overwrite: "auto",
    });
  };

  const onRowEnter = (rowElement: HTMLTableRowElement, index: number) => {
    activeIndexRef.current = index;
    moveHighlightToRow(rowElement);
  };

  const onTableLeave = () => {
    activeIndexRef.current = null;
    if (!highlightRef.current) return;

    gsap.to(highlightRef.current, {
      opacity: 0,
      duration: safeSmoothness,
      ease: "power2.out",
      overwrite: "auto",
    });
  };

  return (
    <>
      {!isCoarsePointer && (
        <div
          style={{ backgroundColor: bgColor }}
          className={`ilp-container relative w-full overflow-hidden font-mono text-white ${className}`}
        >
          {/* Animated sliding subtle glass highlight bar */}
          <div
            ref={highlightRef}
            className="ilp-highlight pointer-events-none absolute inset-x-0 top-0 z-10"
          />

          <div
            ref={tableRef}
            className="ilp-table-wrap relative w-full"
            onMouseLeave={onTableLeave}
          >
            <table className="ilp-table relative z-30 w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: colWidths[0] }} />
                <col style={{ width: colWidths[1] }} />
                <col style={{ width: colWidths[2] }} />
                <col style={{ width: colWidths[3] }} />
              </colgroup>

              <tbody>
                {items.map((item: InteractiveListItem, index: number) => {
                  const itemKey = item.key || (typeof item.client === "string" ? `${item.client}-${index}` : index);
                  return (
                    <tr
                      key={itemKey}
                      ref={(el) => {
                        rowRefs.current[index] = el;
                      }}
                      className={`ilp-row cursor-pointer transition-colors duration-150 ${item.selected ? "ilp-row--selected" : ""}`}
                      onClick={() => onItemClick?.(item, index)}
                      onMouseEnter={(event) =>
                        onRowEnter(event.currentTarget, index)
                      }
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
                        <div
                          className="ilp-actions-group flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.actions ? (
                            item.actions
                          ) : (
                            <>
                              {onOpenFinder && (
                                <button
                                  type="button"
                                  className="ilp-action-btn"
                                  title="Reveal in Finder"
                                  aria-label={`Open ${typeof item.client === "string" ? item.client : ""} in Finder`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenFinder(typeof item.client === "string" ? item.client : "");
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                  </svg>
                                </button>
                              )}
                              {onDeleteProject && (
                                <button
                                  type="button"
                                  className="ilp-action-btn ilp-action-btn--delete"
                                  title="Delete project"
                                  aria-label={`Delete ${typeof item.client === "string" ? item.client : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteProject(typeof item.client === "string" ? item.client : "");
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                  </svg>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

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
          {items.map((item: InteractiveListItem, index: number) => {
            const itemKey = item.key || (typeof item.client === "string" ? `${item.client}-${index}` : index);
            return (
              <div
                key={itemKey}
                className={`flex cursor-pointer items-center justify-between border-b border-white/10 p-3 transition-colors hover:bg-white/5 ${item.selected ? "ilp-row--selected" : ""}`}
                onClick={() => onItemClick?.(item, index)}
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="font-bold uppercase tracking-widest text-sm text-white truncate">
                    {item.client}
                  </div>

                  {item.platform && (
                    <div className="text-xs uppercase tracking-widest text-white/60">
                      {item.platform}
                    </div>
                  )}

                  <div className="text-xs leading-relaxed text-white/50 truncate">
                    {item.services}
                  </div>
                </div>

                <div
                  className="ilp-actions-group flex items-center gap-1.5 ml-3 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.actions ? (
                    item.actions
                  ) : (
                    <>
                      {onOpenFinder && (
                        <button
                          type="button"
                          className="ilp-action-btn"
                          title="Reveal in Finder"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFinder(typeof item.client === "string" ? item.client : "");
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                          </svg>
                        </button>
                      )}
                      {onDeleteProject && (
                        <button
                          type="button"
                          className="ilp-action-btn ilp-action-btn--delete"
                          title="Delete project"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProject(typeof item.client === "string" ? item.client : "");
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
