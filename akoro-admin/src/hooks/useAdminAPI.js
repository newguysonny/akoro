import { useMemo } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';

export default function useAdminAPI() {
  return useMemo(() => ({
    // ─── Users ──────────────────────────────────────────────────────────
    getUsers:        (p = {}) => apiGet(`/api/admin/users?${new URLSearchParams(p)}`).then(r => r.data),
    getUser:         (id)     => apiGet(`/api/admin/users/${id}`).then(r => r.data),
    updateUser:      (id, d)  => apiPatch(`/api/admin/users/${id}`, d).then(r => r.data),
    suspendUser:     (id)     => apiPatch(`/api/admin/users/${id}`, { is_active: false }).then(r => r.data),
    activateUser:    (id)     => apiPatch(`/api/admin/users/${id}`, { is_active: true }).then(r => r.data),
    deleteUser:      (id)     => apiDelete(`/api/admin/users/${id}`).then(r => r.data),

    // ─── Instructors ─────────────────────────────────────────────────────
    getInstructors:  (p = {}) => apiGet(`/api/admin/instructors?${new URLSearchParams(p)}`).then(r => r.data),
    verifyInstructor:(id)     => apiPatch(`/api/admin/instructors/${id}/verify`).then(r => r.data),
    suspendInstructor:(id)    => apiPatch(`/api/admin/instructors/${id}/suspend`).then(r => r.data),

    // ─── Courses ─────────────────────────────────────────────────────────
    getCourses:      (p = {}) => apiGet(`/api/admin/courses?${new URLSearchParams(p)}`).then(r => r.data),
    updateCourse:    (id, d)  => apiPatch(`/api/admin/courses/${id}`, d).then(r => r.data),
    deleteCourse:    (id)     => apiDelete(`/api/admin/courses/${id}`).then(r => r.data),

    // ─── Stats ───────────────────────────────────────────────────────────
    getStats:        ()       => apiGet(`/api/admin/stats`).then(r => r.data),

    // ─── Blog (content schema) ────────────────────────────────────────────
    getBlogPosts:    ()                => apiGet(`/api/content/blog/posts?limit=100`).then(r => r.data),
    getBlogPost:     (id)              => apiGet(`/api/content/blog/posts/${id}`).then(r => r.data),
    createBlogPost:  (d)               => apiPost(`/api/content/admin/blog/posts`, d).then(r => r.data),
    updateBlogPost:  (id, d)           => apiPatch(`/api/content/admin/blog/posts/${id}`, d).then(r => r.data),
    deleteBlogPost:  (id)              => apiDelete(`/api/content/admin/blog/posts/${id}`).then(r => r.data),
    getSubscribers:  ()                => apiGet(`/api/content/admin/blog/subscribers`).then(r => r.data),

    // ─── Careers (content schema) ─────────────────────────────────────────
    getDepartments:      ()       => apiGet(`/api/content/careers/departments`).then(r => r.data),
    createDepartment:    (d)      => apiPost(`/api/content/admin/careers/departments`, d).then(r => r.data),
    updateDepartment:    (id, d)  => apiPatch(`/api/content/admin/careers/departments/${id}`, d).then(r => r.data),
    deleteDepartment:    (id)     => apiDelete(`/api/content/admin/careers/departments/${id}`).then(r => r.data),

    getJobs:             (p = {}) => apiGet(`/api/content/careers/jobs?${new URLSearchParams(p)}`).then(r => r.data),
    createJob:           (d)      => apiPost(`/api/content/admin/careers/jobs`, d).then(r => r.data),
    updateJob:           (id, d)  => apiPatch(`/api/content/admin/careers/jobs/${id}`, d).then(r => r.data),
    deleteJob:           (id)     => apiDelete(`/api/content/admin/careers/jobs/${id}`).then(r => r.data),

    getApplications: (jobId) => apiGet(`/api/content/admin/careers/applications${jobId ? `?job_id=${jobId}` : ''}`).then(r => r.data),
  }), []);
}
