"use client";

import { useEffect, useState } from "react";

type ClockValue = {
  time: string;
  shortTime: string;
  date: string;
};

function format(now: Date): ClockValue {
  return {
    time: now.toLocaleTimeString("zh-CN", { hour12: false }),
    shortTime: now.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })
  };
}

export function LiveClock({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState<ClockValue | null>(null);

  useEffect(() => {
    const update = () => setValue(format(new Date()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = value?.time ?? "--:--:--";
  const shortTime = value?.shortTime ?? "--:--";
  const date = value?.date ?? "正在读取本地时间";

  if (compact) {
    return (
      <div className="clock-block" suppressHydrationWarning>
        <div className="clock-large">{shortTime}</div>
        <div className="clock-date">{date}</div>
      </div>
    );
  }

  return (
    <div suppressHydrationWarning>
      <div className="clock-date">{date}</div>
      <div className="clock-large clock-large--card">{time}</div>
    </div>
  );
}
