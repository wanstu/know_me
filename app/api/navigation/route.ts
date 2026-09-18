import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import {
  createGroup, createItem, deleteGroup, deleteItem, getNavigationTree, incrementItemVisit,
  reorderGroups, reorderItems, updateGroup, updateItem
} from "@/lib/navigation/repository";

export const runtime = "nodejs";

async function authorized() {
  return Boolean(await getSessionUser());
}

function id(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("invalid_id");
  return parsed;
}

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getNavigationTree(true));
}

export async function POST(request: NextRequest) {
  if (!(await authorized())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};

    switch (action) {
      case "create_group": {
        const name = String(data.name ?? "").trim();
        if (!name) throw new Error("group_name_required");
        const createdId = createGroup({
          name, icon: String(data.icon ?? ""),
          visibility: data.visibility === "public" ? "public" : "private"
        });
        return NextResponse.json({ ok: true, id: createdId, tree: getNavigationTree(true) });
      }
      case "update_group": {
        const groupId = id(data.id);
        updateGroup(groupId, {
          ...(data.name !== undefined ? { name: String(data.name) } : {}),
          ...(data.icon !== undefined ? { icon: String(data.icon) } : {}),
          ...(data.visibility !== undefined ? { visibility: data.visibility === "public" ? "public" : "private" } : {})
        });
        return NextResponse.json({ ok: true, tree: getNavigationTree(true) });
      }
      case "delete_group":
        deleteGroup(id(data.id));
        return NextResponse.json({ ok: true, tree: getNavigationTree(true) });
      case "create_item": {
        const name = String(data.name ?? "").trim();
        if (!name) throw new Error("item_name_required");
        const groupId = id(data.groupId);
        const createdId = createItem({
          groupId,
          parentId: data.parentId ? id(data.parentId) : null,
          type: data.type === "folder" ? "folder" : "link",
          name, url: String(data.url ?? ""), iconUrl: String(data.iconUrl ?? ""), iconText: String(data.iconText ?? ""),
          backgroundColor: String(data.backgroundColor ?? ""),
          size: data.size === "2x1" || data.size === "2x2" ? data.size : "1x1",
          visibility: data.visibility === "public" ? "public" : "private"
        });
        return NextResponse.json({ ok: true, id: createdId, tree: getNavigationTree(true) });
      }
      case "update_item": {
        const itemId = id(data.id);
        updateItem(itemId, {
          ...(data.groupId !== undefined ? { groupId: id(data.groupId) } : {}),
          ...(data.parentId !== undefined ? { parentId: data.parentId ? id(data.parentId) : null } : {}),
          ...(data.type !== undefined ? { type: data.type === "folder" ? "folder" : "link" } : {}),
          ...(data.name !== undefined ? { name: String(data.name) } : {}),
          ...(data.url !== undefined ? { url: String(data.url) } : {}),
          ...(data.iconUrl !== undefined ? { iconUrl: String(data.iconUrl) } : {}),
          ...(data.iconText !== undefined ? { iconText: String(data.iconText) } : {}),
          ...(data.backgroundColor !== undefined ? { backgroundColor: String(data.backgroundColor) } : {}),
          ...(data.size !== undefined ? { size: data.size === "2x1" || data.size === "2x2" ? data.size : "1x1" } : {}),
          ...(data.visibility !== undefined ? { visibility: data.visibility === "public" ? "public" : "private" } : {})
        });
        return NextResponse.json({ ok: true, tree: getNavigationTree(true) });
      }
      case "delete_item":
        deleteItem(id(data.id));
        return NextResponse.json({ ok: true, tree: getNavigationTree(true) });
      case "reorder_groups": {
        const ids = Array.isArray(data.ids) ? data.ids.map(id) : [];
        reorderGroups(ids);
        return NextResponse.json({ ok: true, tree: getNavigationTree(true) });
      }
      case "reorder_items": {
        const groupId = id(data.groupId);
        const parentId = data.parentId ? id(data.parentId) : null;
        const ids = Array.isArray(data.ids) ? data.ids.map(id) : [];
        reorderItems(groupId, parentId, ids);
        return NextResponse.json({ ok: true, tree: getNavigationTree(true) });
      }
      case "visit":
        incrementItemVisit(id(data.id));
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
