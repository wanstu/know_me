export type DemoTile = {
  name: string;
  mark: string;
  href: string;
  tone?: "pink" | "red" | "blue" | "green" | "amber";
  wide?: boolean;
  folder?: boolean;
};

export const startTiles: DemoTile[] = [
  { name: "哔哩哔哩", mark: "B", href: "#", tone: "pink", wide: true },
  { name: "YouTube", mark: "▶", href: "#", tone: "red", wide: true },
  { name: "AC Fun", mark: "A", href: "#", tone: "blue", wide: true },
  { name: "语雀", mark: "语", href: "#", tone: "green" },
  { name: "AI 助手", mark: "AI", href: "#" },
  { name: "WordPress", mark: "W", href: "#", wide: true },
  { name: "音乐 / 视频", mark: "♪", href: "#", wide: true },
  { name: "我的主页", mark: "ME", href: "/", tone: "amber" },
  { name: "Packages", mark: "PK", href: "#", tone: "blue" },
  { name: "Mail", mark: "✉", href: "#", tone: "red" },
  { name: "工作", mark: "", href: "#", folder: true },
  { name: "本地服务", mark: "", href: "#", folder: true }
];

export const demoPosts = [
  {
    slug: "one-site-three-entrances",
    date: "2026-09-18",
    reading: "8 min",
    tag: "开发",
    title: "把个人主页、博客和浏览器起始页做成同一个产品",
    excerpt: "为什么不再维护三个彼此独立的小站，以及统一数据模型后能解决什么问题。"
  },
  {
    slug: "markdown-writing-system",
    date: "2026-09-12",
    reading: "12 min",
    tag: "笔记",
    title: "Markdown 写作系统应该保留哪些能力",
    excerpt: "从编辑、图片、代码块、修订历史到全文搜索，整理一套长期可维护的写作流程。"
  },
  {
    slug: "homepage-is-an-entry",
    date: "2026-09-03",
    reading: "6 min",
    tag: "生活",
    title: "主页不是简历，而是一个入口",
    excerpt: "减少不必要的信息，留下真正希望别人点击的内容。"
  }
];
