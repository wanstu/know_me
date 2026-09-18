export type NavVisibility = "private" | "public";
export type NavItemType = "link" | "folder";
export type NavItemSize = "1x1" | "2x1" | "2x2";

export type NavItem = {
  id: number;
  externalId: string | null;
  groupId: number;
  parentId: number | null;
  type: NavItemType;
  name: string;
  url: string;
  iconUrl: string;
  iconText: string;
  backgroundColor: string;
  size: NavItemSize;
  visitCount: number;
  sortOrder: number;
  visibility: NavVisibility;
  browserLocal: boolean;
  extra: Record<string, unknown>;
  children: NavItem[];
};

export type NavGroup = {
  id: number;
  externalId: string | null;
  name: string;
  icon: string;
  sortOrder: number;
  visibility: NavVisibility;
  extra: Record<string, unknown>;
  items: NavItem[];
};

export type NavigationTree = {
  groups: NavGroup[];
};
