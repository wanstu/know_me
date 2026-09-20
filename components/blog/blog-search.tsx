"use client";

import { useEffect, useRef } from "react";

export function BlogSearch({ defaultValue }: { defaultValue: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "f") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form action="/blog" method="get">
      <input
        ref={inputRef}
        className="blog-search"
        name="q"
        defaultValue={defaultValue}
        placeholder="搜索文章、标签或关键词…"
        aria-label="搜索博客"
      />
    </form>
  );
}
