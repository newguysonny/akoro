/**
 * timetableTemplate.js — starter timetable templates (junior / senior),
 * mirroring 2026-seed-timetable.sql so schools can one-click load a class
 * timetable that matches the printed reference layout.
 */

// 14 periods: assembly · teaching · break · lunch · activity, with time ranges.
export const PERIOD_DEFS = [
  { name: "Assembly", starts_at: "07:00", ends_at: "08:20", sort_order: 1,  type: "assembly" },
  { name: "P1",       starts_at: "08:20", ends_at: "09:00", sort_order: 2,  type: "teaching" },
  { name: "P2",       starts_at: "09:00", ends_at: "09:40", sort_order: 3,  type: "teaching" },
  { name: "Break 1",  starts_at: "09:40", ends_at: "10:00", sort_order: 4,  type: "break" },
  { name: "P3",       starts_at: "10:00", ends_at: "10:40", sort_order: 5,  type: "teaching" },
  { name: "P4",       starts_at: "10:40", ends_at: "11:20", sort_order: 6,  type: "teaching" },
  { name: "Break 2",  starts_at: "11:20", ends_at: "11:35", sort_order: 7,  type: "break" },
  { name: "P5",       starts_at: "11:35", ends_at: "12:05", sort_order: 8,  type: "teaching" },
  { name: "Lunch",    starts_at: "12:05", ends_at: "12:55", sort_order: 9,  type: "lunch" },
  { name: "P6",       starts_at: "12:55", ends_at: "14:00", sort_order: 10, type: "teaching" },
  { name: "P7",       starts_at: "14:00", ends_at: "14:40", sort_order: 11, type: "teaching" },
  { name: "P8",       starts_at: "14:40", ends_at: "15:20", sort_order: 12, type: "teaching" },
  { name: "P9",       starts_at: "15:20", ends_at: "16:00", sort_order: 13, type: "teaching" },
  { name: "Activity", starts_at: "16:00", ends_at: "17:00", sort_order: 14, type: "activity" },
];

// Teaching column (1..9) → period name.
export const TEACH_PERIOD_NAMES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"];

// Subjects referenced by the templates: [name, code, type].
export const TEMPLATE_SUBJECTS = [
  ["English", "ENG", "core"], ["Social Studies", "SST", "core"],
  ["Mathematics", "MATHS", "core"], ["Business Studies", "BST", "core"],
  ["Kiswahili", "KISW", "core"], ["Religious Education", "REL.E", "core"],
  ["Visual Arts", "V.Arts", "elective"], ["Performing Arts", "P.Arts", "elective"],
  ["Pre-Technical Studies", "PRE-TECH", "core"], ["Physical Education & Sports", "P.E&S", "core"],
  ["Agriculture", "AGRIC", "core"], ["Integrated Science", "INT/SCI", "core"],
  ["Health Education", "H.E", "core"], ["Home Science", "H.SCIE", "elective"],
  ["Computer Science", "COMP SCIE", "elective"], ["Life Skills", "L/SKILL", "core"],
  ["Biology", "BIO", "core"], ["Chemistry", "CHE", "core"], ["Physics", "PHY", "core"],
  ["Economics", "ECON", "core"], ["Geography", "GEO", "core"], ["Literature", "LIT", "core"],
];

// Each day = 9 teaching cells; a cell is "CODE" or ["CODE","ALT"] (A or B).
export const JUNIOR_GRID = [
  ["ENG", "SST", "MATHS", "BST", "KISW", "REL.E", ["V.Arts", "P.Arts"], "PRE-TECH", "PRE-TECH"],
  ["REL.E", "MATHS", "KISW", "P.E&S", "AGRIC", "AGRIC", "ENG", "BST", ["H.SCIE", "COMP SCIE"]],
  ["KISW", "MATHS", "INT/SCI", "INT/SCI", "ENG", "SST", "H.E", ["H.SCIE", "COMP SCIE"], ["V.Arts", "P.Arts"]],
  ["MATHS", "H.E", "BST", "ENG", "KISW", "P.E&S", "PRE-TECH", "PRE-TECH", ["H.SCIE", "COMP SCIE"]],
  ["ENG", "L/SKILL", "MATHS", "SST", "INT/SCI", "INT/SCI", "REL.E", ["V.Arts", "P.Arts"], "AGRIC"],
];

export const SENIOR_GRID = [
  ["ENG", "MATHS", "PHY", "CHE", "BIO", "ECON", ["V.Arts", "P.Arts"], "GEO", "LIT"],
  ["MATHS", "ENG", "CHE", "PHY", "BIO", "GEO", "ECON", "LIT", "AGRIC"],
  ["BIO", "CHE", "MATHS", "ENG", "PHY", "LIT", "GEO", ["H.SCIE", "COMP SCIE"], "REL.E"],
  ["PHY", "BIO", "ENG", "MATHS", "CHE", "AGRIC", "ECON", "GEO", ["H.SCIE", "COMP SCIE"]],
  ["ENG", "MATHS", "GEO", "LIT", "BIO", "CHE", "PHY", "REL.E", ["V.Arts", "P.Arts"]],
];
