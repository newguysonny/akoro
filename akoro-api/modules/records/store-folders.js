/**
 * modules/records/store-folders.js — Supabase queries for folders and their
 * items. Ownership is carried in the query wherever the caller is a learner
 * (user_id), so a read cannot cross accounts.
 */
import db from "../../db.js";
import { applyCursor } from "./rules.js";

const edu = () => db.schema("edu");

export const listFolders = ({ userId, limit, cursor }) =>
  applyCursor(
    edu().from("library_folders")
      .select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }),
    cursor,
  ).limit(limit);

export const countFolders = (userId) =>
  edu().from("library_folders")
    .select("*", { count: "exact", head: true }).eq("user_id", userId);

export const countFoldersForCreate = (userId) =>
  edu().from("library_folders").select("id", { count: "exact", head: true }).eq("user_id", userId);

export const insertFolder = (row) =>
  edu().from("library_folders").insert(row).select().single();

export const getFolderOwner = (id) =>
  edu().from("library_folders").select("id, user_id").eq("id", id).maybeSingle();

export const getFolderForDelete = (id) =>
  edu().from("library_folders").select("id, user_id, cover_key").eq("id", id).maybeSingle();

export const updateFolder = (id, patch) =>
  edu().from("library_folders").update(patch).eq("id", id).select().single();

export const deleteFolder = (id) =>
  edu().from("library_folders").delete().eq("id", id);

export const folderItemCounts = (userId) =>
  edu().from("library_folder_items").select("folder_id").eq("user_id", userId);

export const listFolderItems = ({ folderId, limit, cursor }) =>
  applyCursor(
    edu().from("library_folder_items")
      .select("id, item_type, item_ref, title, sub, kind, link, created_at")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }),
    cursor,
  ).limit(limit);

export const countFolderItems = (folderId) =>
  edu().from("library_folder_items")
    .select("*", { count: "exact", head: true }).eq("folder_id", folderId);

export const listOwnedFolders = ({ userId, folderIds }) =>
  edu().from("library_folders")
    .select("id, name").eq("user_id", userId).in("id", folderIds);

export const countItemsInFolder = (folderId) =>
  edu().from("library_folder_items")
    .select("id", { count: "exact", head: true }).eq("folder_id", folderId);

export const upsertFolderItem = (row) =>
  edu().from("library_folder_items")
    .upsert(row, { onConflict: "folder_id,item_type,item_ref" });
