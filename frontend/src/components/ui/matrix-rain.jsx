import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * MatrixRain — Digital falling character rain animation.
 * Ported from @componentry/matrix-rain.
 *
 * @param {Object} props
 * @param {string} [props.className] - Optional extra CSS classes
 * @param {"default" | "cyan" | "rainbow"} [props.variant="default"] - Color palette
 * @param {number} [props.width] - Fixed canvas width (defaults to parent width)
 * @param {number} [props.height] - Fixed canvas height (defaults to parent height)
 * @param {number} [props.fontSize=16] - Size of falling characters in px
 * @param {number} [props.speed=50] - Interval between frames in ms
 * @param {string} [props.fixedColor] - Custom override color (hex/rgb)
 * @param {boolean} [props.transparent=false] - Transparent background trail
 */
export function MatrixRain({
  className,
  variant = 'default',
  width,
  height,
  fontSize = 16,
  speed = 50,
  fixedColor,
  transparent = false,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Observe parent sizing if explicit width/height aren't supplied
    const resizeObserver = new ResizeObserver(() => {
      if (!width && !height) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      }
    });
    resizeObserver.observe(canvas);

    if (width) canvas.width = width;
    if (height) canvas.height = height;
    if (!width && !height) {
      canvas.width = canvas.offsetWidth || 300;
      canvas.height = canvas.offsetHeight || 150;
    }

    const w = canvas.width;
    const h = canvas.height;

    const columns = Math.max(1, Math.floor(w / fontSize));
    const drops = new Array(columns).fill(1);

    // Character set: Katakana + digits
    const chars = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ1234567890';

    let isDark = document.documentElement.classList.contains('dark') || true;

    if (!transparent) {
      ctx.fillStyle = isDark ? '#000000' : '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }

    const draw = () => {
      const currentIsDark = document.documentElement.classList.contains('dark') || true;

      if (currentIsDark !== isDark) {
        isDark = currentIsDark;
        if (!transparent) {
          ctx.fillStyle = isDark ? '#000000' : '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }

      if (transparent) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)] || '';

        if (variant === 'rainbow' && !fixedColor) {
          const hue = (Date.now() / 20 + i * 10) % 360;
          ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        } else if (fixedColor) {
          ctx.fillStyle = fixedColor;
        } else if (variant === 'cyan') {
          ctx.fillStyle = isDark ? '#0FF' : '#0e7490';
        } else {
          ctx.fillStyle = isDark ? '#0F0' : '#15803d';
        }

        const x = i * fontSize;
        const y = drops[i] * fontSize;

        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }

        drops[i]++;
      }
    };

    const interval = setInterval(draw, speed);

    return () => {
      clearInterval(interval);
      resizeObserver.disconnect();
    };
  }, [variant, fontSize, speed, fixedColor, width, height, transparent]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('matrix-rain-canvas', className)}
      style={{
        width: width ?? '100%',
        height: height ?? '100%',
        display: 'block',
        borderRadius: 'inherit',
      }}
    />
  );
}

export default MatrixRain;
