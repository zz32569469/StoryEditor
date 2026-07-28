import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * 可拖曳的左右分隔線。
 *
 * 右側編輯面板的寬度由使用者決定並記住 —— 有人想把預覽區拉大看排版，
 * 有人在編變數表時想要更多欄位空間，固定寬度不可能同時滿足。
 */

const STORAGE_KEY = 'storyeditor:editorWidth';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 300;
/** 預覽區至少要留這麼寬，否則對話框會擠到看不出排版。 */
const MIN_PREVIEW = 360;
/** 鍵盤每次調整的幅度。 */
const STEP = 24;

function clamp(width: number, viewport: number): number {
  const max = Math.max(MIN_WIDTH, viewport - MIN_PREVIEW);
  return Math.min(Math.max(width, MIN_WIDTH), max);
}

function readStored(): number {
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WIDTH;
}

export function useSplitPane() {
  /**
   * 掛在左右分欄的容器上。
   *
   * 寬度用容器自己的邊界計算，不用 window.innerWidth ——
   * 頁面若不是貼齊視窗左緣（內嵌、捲軸、外層留白），兩者會差一段，
   * 拖曳就會跟著偏移。
   */
  const containerRef = useRef<HTMLElement | null>(null);

  const containerWidth = useCallback(
    () => containerRef.current?.getBoundingClientRect().width ?? window.innerWidth,
    [],
  );

  const [width, setWidth] = useState(() => {
    try {
      return readStored();
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const [isResizing, setResizing] = useState(false);
  const frame = useRef(0);

  const apply = useCallback(
    (next: number) => setWidth(clamp(next, containerWidth())),
    [containerWidth],
  );

  // 視窗變小時把面板收窄，否則預覽區會被擠沒。
  useEffect(() => {
    const onResize = () => setWidth((current) => clamp(current, containerWidth()));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [containerWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // 隱私模式等情況存不了，寬度只是偏好設定，失敗就算了。
    }
  }, [width]);

  const stopDrag = useRef<(() => void) | null>(null);

  // 元件卸載時若還在拖曳，要把 window 上的監聽收乾淨。
  useEffect(() => () => stopDrag.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();

      // setPointerCapture 只是加分：讓游標離開元素後事件仍送回來。
      // 它在某些情況會丟 NotFoundError，不能讓拖曳跟著整個失效。
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 沒有 capture 也能運作 —— 下面監聽的是 window。
      }

      setResizing(true);

      const move = (e: PointerEvent) => {
        // 用 rAF 節流：拖曳時 pointermove 每毫秒都可能觸發，
        // 每次都 setState 會讓整棵樹重繪到掉幀。
        cancelAnimationFrame(frame.current);
        const x = e.clientX;
        const right = containerRef.current?.getBoundingClientRect().right ?? window.innerWidth;
        frame.current = requestAnimationFrame(() => apply(right - x));
      };

      const up = () => {
        cancelAnimationFrame(frame.current);
        setResizing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        stopDrag.current = null;
      };

      // 監聽 window 而不是分隔線本身：滑鼠拖得比重繪快時會離開那 5px，
      // 掛在元素上的監聽就會中途斷掉。
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      stopDrag.current = up;
    },
    [apply],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') apply(width + STEP);
      else if (event.key === 'ArrowRight') apply(width - STEP);
      else if (event.key === 'Home') apply(DEFAULT_WIDTH);
      else return;
      event.preventDefault();
    },
    [apply, width],
  );

  return {
    containerRef,
    width,
    isResizing,
    /** 雙擊還原成預設寬度。 */
    resetWidth: () => apply(DEFAULT_WIDTH),
    resizerProps: {
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': Math.round(width),
      tabIndex: 0,
      title: '拖曳調整寬度（雙擊還原，方向鍵可微調）',
      onPointerDown,
      onKeyDown,
    },
  };
}
