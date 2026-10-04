import { useRef, useEffect } from 'react';

/**
 * OmpToolCard — React bridge to OMP's <omp-tool-view> Web Component.
 * Surfaces all 31 OMP tool renderers (write, edit, read, bash, eval, grep, glob, ask, etc.)
 * with syntax highlighting, colored diffs, line counts, and execution exit codes.
 */
export default function OmpToolCard({
  name,
  args,
  result,
  running = false,
  intent,
  defaultOpen = false,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.data = {
        name,
        args: args || {},
        result: result ?? undefined,
        running: Boolean(running),
        intent: intent || undefined,
        defaultOpen: Boolean(defaultOpen),
      };
    }
  }, [name, args, result, running, intent, defaultOpen]);

  return <omp-tool-view ref={ref} />;
}
