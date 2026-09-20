export type SocialLink = { id: string; label: string; url: string };
export type HomeEntry = { id: string; name: string; description: string; url: string; newTab: boolean };
export type ProjectEntry = { id: string; name: string; description: string; url: string; tag: string };
export type FriendLink = { id: string; name: string; url: string; visible: boolean };

export type SiteSettings = {
  profileName: string;
  profileTagline: string;
  profileBio: string;
  avatarUrl: string;
  quote: string;
  quoteAuthor: string;
  quoteEnabled: boolean;
  quoteAuthorEnabled: boolean;
  githubUrl: string;
  emailUrl: string;
  aboutUrl: string;
  homeBackgroundUrl: string;
  startBackgroundUrl: string;
  startPublic: boolean;
  defaultSearchEngine: "Bing" | "Google" | "DuckDuckGo";
  themeMode: "auto" | "dark" | "light";
  themePreset: string;
  startDensity: "compact" | "comfortable" | "spacious";
  startCardOpacity: number;
  startCardRadius: number;
  startBackgroundDim: number;
  socialLinks: SocialLink[];
  homeEntries: HomeEntry[];
  projects: ProjectEntry[];
  showIcp: boolean;
  icpNumber: string;
  icpUrl: string;
  showPolice: boolean;
  policeNumber: string;
  policeUrl: string;
  footerText: string;
  showFriendLinks: boolean;
  friendLinks: FriendLink[];
};

export type SessionUser = { id: number; username: string; displayName: string; avatar: string };

export type NavItem = {
  id: number;
  externalId?: string | null;
  groupId: number;
  parentId?: number | null;
  type: "link" | "folder";
  name: string;
  url: string;
  iconUrl: string;
  iconText: string;
  backgroundColor: string;
  size: "1x1" | "2x1" | "2x2";
  visitCount: number;
  visibility: "public" | "private";
  browserLocal: boolean;
  extra: Record<string, unknown>;
  children: NavItem[];
};

export type NavGroup = {
  id: number;
  name: string;
  icon: string;
  visibility: "public" | "private";
  items: NavItem[];
};

export type PostRecord = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  status: "draft" | "published" | "scheduled";
  pinned: boolean;
  seoTitle: string;
  seoDescription: string;
  publishedAt: number | null;
  firstPublishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  categories: string[];
};

export type PostRevision = {
  id: number;
  postId: number;
  contentMd: string;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export type MediaRecord = {
  id: number;
  storageKey: string;
  originalName: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  alt: string;
  createdAt: number;
  url: string;
};
