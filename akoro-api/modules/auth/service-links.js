/**
 * auth/service-links.js — every frontend address the auth flows link to.
 * Domains are never spelled here: urlFor() owns the defaults.
 */

import { urlFor } from "../../lib/urls.js";

export const FRONTEND_URL            = urlFor("FRONTEND_URL");
export const INSTRUCTOR_FRONTEND_URL = urlFor("INSTRUCTOR_FRONTEND_URL");
export const ADMIN_FRONTEND_URL      = urlFor("ADMIN_FRONTEND_URL");
export const SCHOOL_FRONTEND_URL     = urlFor("SCHOOL_FRONTEND_URL");
export const AGENT_FRONTEND_URL      = urlFor("AGENT_FRONTEND_URL");
export const BUSINESS_FRONTEND_URL   = urlFor("BUSINESS_FRONTEND_URL");

// Map a portal name to its frontend base URL.
export const portalUrl = (portal) =>
  portal === "instructor" ? INSTRUCTOR_FRONTEND_URL
  : portal === "admin"    ? ADMIN_FRONTEND_URL
  : portal === "school"   ? SCHOOL_FRONTEND_URL
  : portal === "agent"    ? AGENT_FRONTEND_URL
  : portal === "business" ? BUSINESS_FRONTEND_URL
  : FRONTEND_URL;

export const PORTAL_URLS = [FRONTEND_URL, INSTRUCTOR_FRONTEND_URL, ADMIN_FRONTEND_URL, SCHOOL_FRONTEND_URL, AGENT_FRONTEND_URL, BUSINESS_FRONTEND_URL];
