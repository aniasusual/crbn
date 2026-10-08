"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import { cn } from "@/lib/utils";
import "./magnetic-dock.css";

export interface DockItemData {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Icon component or React node */
  icon: React.ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Whether item is active */
  isActive?: boolean;
  /** Optional badge count */
  badge?: number;
  /** Optional custom tooltip text (falls back to label) */
  tooltip?: string;
  /** Optional disabled state */
  disabled?: boolean;
}

export interface MagneticDockProps {
  /** Array of dock items */
  items: DockItemData[];
  /** Size of icons in pixels (default 42) */
  iconSize?: number;
  /** Maximum scale on hover (default 1.35) */
  maxScale?: number;
  /** Distance of magnetic effect in pixels (default 140) */
  magneticDistance?: number;
  /** Show labels on hover */
  showLabels?: boolean;
  /** Dock position */
  position?: "bottom" | "top" | "left" | "right";
  /** Background style */
  variant?: "glass" | "solid" | "transparent";
  /** Custom class name */
  className?: string;
  /** Optional leading element */
  leading?: React.ReactNode;
  /** Optional trailing element */
  trailing?: React.ReactNode;
}

interface DockItemProps {
  item: DockItemData;
  mouseX: MotionValue<number>;
  iconSize: number;
  maxScale: number;
  magneticDistance: number;
  showLabels: boolean;
  isVertical: boolean;
  reducedMotion: boolean;
}

function DockItem({
  item,
  mouseX,
  iconSize,
  maxScale,
  magneticDistance,
  showLabels,
  isVertical,
  reducedMotion,
}: DockItemProps) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const showLabel = showLabels && (isHovered || isFocused);

  // Calculate distance from mouse to center of item
  const distance = useTransform(mouseX, (val: number) => {
    if (!ref.current) return magneticDistance + 1;
    const rect = ref.current.getBoundingClientRect();
    const center = isVertical
      ? rect.top + rect.height / 2
      : rect.left + rect.width / 2;
    return val - center;
  });

  // Scale based on distance - closer = larger
  const scale = useTransform(
    distance,
    [-magneticDistance, 0, magneticDistance],
    [1, maxScale, 1],
    { clamp: true }
  );

  // Apply spring physics for smooth animation
  const springConfig = { damping: 20, stiffness: 300, mass: 0.5 };
  const smoothScale = useSpring(scale, springConfig);

  // Calculate the size based on scale
  const size = useTransform(smoothScale, (s) => s * iconSize);

  // Floating effect
  const y = useTransform(smoothScale, (s) => (s - 1) * -8);
  const smoothY = useSpring(y, springConfig);

  const tooltipText = item.tooltip || item.label;

  return (
    <motion.button
      ref={ref}
      type="button"
      tabIndex={0}
      aria-label={item.label}
      aria-current={item.isActive ? "page" : undefined}
      disabled={item.disabled}
      onClick={item.onClick}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "magnetic-dock-item",
        "relative flex items-center justify-center rounded-2xl transition-colors duration-200 focus:outline-none",
        item.isActive && "magnetic-dock-item--active",
        item.disabled && "opacity-50 pointer-events-none"
      )}
      style={{
        width: reducedMotion ? iconSize : size,
        height: reducedMotion ? iconSize : size,
        y: reducedMotion || isVertical ? 0 : smoothY,
        x: reducedMotion || !isVertical ? 0 : smoothY,
      }}
      whileTap={reducedMotion ? undefined : { scale: 0.92 }}
    >
      {/* Icon Tile Surface */}
      <motion.div
        className={cn(
          "magnetic-dock-surface",
          "relative w-full h-full rounded-2xl overflow-hidden flex items-center justify-center transition-colors duration-200"
        )}
      >
        <div
          aria-hidden="true"
          className="magnetic-dock-icon w-[60%] h-[60%] flex items-center justify-center text-white"
        >
          {item.icon}
        </div>

        {/* Specular Shine Reflection */}
        <div className="magnetic-dock-shine" />
      </motion.div>

      {/* Badge */}
      <AnimatePresence initial={false}>
        {item.badge !== undefined && item.badge > 0 && (
          <motion.div
            initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            className="magnetic-dock-badge"
          >
            {item.badge > 99 ? "99+" : item.badge}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Indicator Dot */}
      <AnimatePresence initial={false}>
        {item.isActive && (
          <motion.div
            initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            className="magnetic-dock-active-dot"
          />
        )}
      </AnimatePresence>

      {/* Tooltip */}
      <AnimatePresence initial={false}>
        {showLabel && tooltipText && (
          <div className="magnetic-dock-tooltip-anchor">
            <motion.div
              role="tooltip"
              aria-hidden="true"
              initial={reducedMotion ? false : { opacity: 0, y: 5, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.94 }}
              transition={{ duration: 0.13, ease: "easeOut" }}
              className="magnetic-dock-tooltip"
            >
              {tooltipText}
              <div className="magnetic-dock-tooltip-arrow" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function MagneticDock({
  items,
  iconSize = 42,
  maxScale = 1.35,
  magneticDistance = 140,
  showLabels = true,
  position = "bottom",
  variant = "glass",
  className,
  leading,
  trailing,
}: MagneticDockProps) {
  const mousePosition = useMotionValue(Infinity);
  const reducedMotion = useReducedMotion() ?? false;
  const isVertical = position === "left" || position === "right";

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent) => {
      if (isVertical) {
        mousePosition.set(e.clientY);
      } else {
        mousePosition.set(e.clientX);
      }
    },
    [mousePosition, isVertical]
  );

  const handleMouseLeave = React.useCallback(() => {
    mousePosition.set(Infinity);
  }, [mousePosition]);

  const variantClass = `magnetic-dock-container--${variant}`;

  return (
    <motion.div
      onMouseMove={reducedMotion ? undefined : handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "magnetic-dock-container",
        variantClass,
        className
      )}
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {leading}
      {items.map((item) => (
        <DockItem
          key={item.id}
          item={item}
          mouseX={mousePosition}
          iconSize={iconSize}
          maxScale={maxScale}
          magneticDistance={magneticDistance}
          showLabels={showLabels}
          isVertical={isVertical}
          reducedMotion={reducedMotion}
        />
      ))}
      {trailing}
    </motion.div>
  );
}

// Preset Icons from @componentry/magnetic-dock
export function DockIconHome({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <path d="M3 9.5l9-7 9 7v10.5a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5z" />
      <polyline points="9 21.5 9 12 15 12 15 21.5" />
    </svg>
  );
}

export function DockIconSearch({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <circle cx="11" cy="11" r="7.5" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

export function DockIconFolder({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function DockIconMail({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

export function DockIconMusic({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function DockIconSettings({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function DockIconTrash({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// Dedicated Preview Panel Action Icons
export function DockIconEye({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function DockIconCode({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

export function DockIconDevices({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <rect x="2" y="4" width="14" height="11" rx="2" />
      <path d="M6 19h6" />
      <rect x="15" y="9" width="7" height="11" rx="1.5" />
    </svg>
  );
}

export function DockIconResponsive({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export function DockIconDesktop({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <rect x="2" y="3" width="20" height="14" rx="2.5" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export function DockIconTablet({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <rect x="4" y="2" width="16" height="20" rx="2.5" />
      <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5" />
    </svg>
  );
}

export function DockIconMobile({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5" />
    </svg>
  );
}

export function DockIconRotate({
  className,
  isLandscape = false,
}: {
  className?: string;
  isLandscape?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
      style={{
        transform: isLandscape ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.25s ease",
      }}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

export function DockIconRefresh({
  className,
  spinning = false,
}: {
  className?: string;
  spinning?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className, spinning && "magnetic-dock-spin")}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

export function DockIconExternal({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-full h-full", className)}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export default MagneticDock;
