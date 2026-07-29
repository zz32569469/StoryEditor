import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 把一段畫面搬到另一個瀏覽器視窗。
 *
 * 這裡只負責開視窗與準備掛載點；內容由呼叫方用 `createPortal` 渲染進去。
 * 這樣做的關鍵好處是**副視窗仍屬於同一棵 React tree、同一個 store** ——
 * 不需要訊息傳遞、不需要序列化、也不會有兩份會互相蓋掉的狀態。
 * 若改成「副視窗自己跑一份 app」，光是同步就是一整套機制。
 */

/** 把主視窗的樣式搬進副視窗，並持續跟進之後才載入的。 */
function mirrorStyles(source: Document, target: Document): () => void {
  const copyOf = new Map<Node, HTMLElement>();

  const clone = (node: Node): HTMLElement | null => {
    if (!(node instanceof source.defaultView!.HTMLElement)) return null;

    if (node.tagName === 'STYLE') {
      const style = target.createElement('style');
      style.textContent = node.textContent;
      return style;
    }
    if (node.tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet') {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = (node as HTMLLinkElement).href;
      return link;
    }
    return null;
  };

  const add = (node: Node) => {
    if (copyOf.has(node)) return;
    const copy = clone(node);
    if (!copy) return;
    copyOf.set(node, copy);
    target.head.appendChild(copy);
  };

  for (const node of Array.from(source.head.childNodes)) add(node);

  /**
   * 樣式不是一次到位的：流程圖的 CSS 是延後載入的 chunk，開發時 HMR 也會
   * 直接改 <style> 的內容。只複製一次的話，副視窗會停在沒有樣式或舊樣式的狀態。
   */
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) add(node);
      for (const node of Array.from(record.removedNodes)) {
        copyOf.get(node)?.remove();
        copyOf.delete(node);
      }
      // HMR 改的是既有 <style> 的文字內容，節點本身沒有換。
      if (record.type === 'characterData') {
        const owner = record.target.parentNode;
        if (owner && copyOf.has(owner)) {
          copyOf.get(owner)!.textContent = owner.textContent;
        }
      }
    }
  });
  observer.observe(source.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return () => observer.disconnect();
}

export interface PopoutWindow {
  /** portal 的目標；null 代表視窗沒開。 */
  container: HTMLElement | null;
  isOpen: boolean;
  /** 回傳 false 代表被瀏覽器擋掉了。 */
  open: () => boolean;
  close: () => void;
}

export function usePopoutWindow(title: string, features = 'width=1200,height=860'): PopoutWindow {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const windowRef = useRef<Window | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    windowRef.current?.close();
    windowRef.current = null;
    setContainer(null);
  }, []);

  const open = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.focus();
      return true;
    }

    // about:blank 與開啟者同源，才能寫入它的 document。
    const popup = window.open('', '', features);
    if (!popup) return false;

    popup.document.title = title;
    const mount = popup.document.createElement('div');
    mount.className = 'popout-root';
    popup.document.body.appendChild(mount);

    const stopMirroring = mirrorStyles(document, popup.document);

    // 主視窗重新整理或關閉時，別留下一個沒人管的孤兒視窗。
    const closePopup = () => popup.close();
    window.addEventListener('beforeunload', closePopup);

    /**
     * 除了監聽 pagehide，還要定時檢查 popup.closed。
     *
     * 視窗被使用者直接關掉時 pagehide 不保證會送到開啟者這邊，漏掉的話
     * 主視窗會一直顯示「收回流程圖」，但那個視窗早就不在了。
     */
    const poll = window.setInterval(() => {
      if (popup.closed) onGone();
    }, 1000);

    const onGone = () => {
      window.clearInterval(poll);
      stopMirroring();
      popup.removeEventListener('pagehide', onGone);
      window.removeEventListener('beforeunload', closePopup);
      cleanupRef.current = null;
      windowRef.current = null;
      setContainer(null);
    };
    popup.addEventListener('pagehide', onGone);

    cleanupRef.current = () => {
      window.clearInterval(poll);
      stopMirroring();
      popup.removeEventListener('pagehide', onGone);
      window.removeEventListener('beforeunload', closePopup);
    };

    windowRef.current = popup;
    setContainer(mount);
    return true;
  }, [features, title]);

  // 元件卸載時一併收掉，否則視窗會留在畫面上但內容永遠不再更新。
  useEffect(() => () => close(), [close]);

  return { container, isOpen: container !== null, open, close };
}
