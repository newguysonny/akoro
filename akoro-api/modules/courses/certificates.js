/**
 * routes/certificates.js  —  Piabam Course Completion Certificates
 *
 * Generates a PDF certificate when a student completes 100% of a course.
 * Stores the PDF in Cloudflare R2 and saves the URL in the certificates table.
 * Subsequent requests for the same certificate return the cached R2 URL.
 *
 * Usage in app.js:
 *   import certificatesRouter from "./routes/certificates.js";
 *   app.use("/api", certificatesRouter);
 *
 * Dependencies:
 *   npm install pdf-lib
 */

import { Router }                         from "express";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { S3Client, PutObjectCommand }     from "@aws-sdk/client-s3";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/routes.js";
import config                             from "../../config/index.js";
import { r2Send } from "../../lib/r2Breaker.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

// ─── R2 client ────────────────────────────────────────────────────────────────

const r2 = new S3Client({
  region:      "auto",
  endpoint:    `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});

const uploadPdfToR2 = async (pdfBytes, key) => {
  await r2Send(r2, new PutObjectCommand({
    Bucket:      config.r2.bucketName,
    Key:         key,
    Body:        Buffer.from(pdfBytes),
    ContentType: "application/pdf",
    ACL:         "public-read",
  }));
  return `${config.r2.publicUrl}/${key}`;
};

// ─── PDF generator ────────────────────────────────────────────────────────────

/**
 * generateCertificatePdf
 * Creates an A4 landscape PDF certificate using pdf-lib.
 * Returns the raw PDF bytes (Uint8Array).
 */
const generateCertificatePdf = async ({ studentName, courseTitle, instructorName, completedAt, certificateId }) => {
  const doc    = await PDFDocument.create();
  const page   = doc.addPage([841.89, 595.28]);  // A4 landscape (pts)
  const { width, height } = page.getSize();

  const fontBold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await doc.embedFont(StandardFonts.Helvetica);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Background
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.98, 0.97, 0.96) });

  // Outer border
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40,
    borderColor: rgb(0.91, 0.53, 0.29), borderWidth: 3 });

  // Inner border
  page.drawRectangle({ x: 32, y: 32, width: width - 64, height: height - 64,
    borderColor: rgb(0.91, 0.53, 0.29), borderWidth: 1 });

  // Header — Piabam
  page.drawText("PIABAM", {
    x: width / 2 - fontBold.widthOfTextAtSize("PIABAM", 36) / 2,
    y: height - 90, font: fontBold, size: 36, color: rgb(0.10, 0.10, 0.18),
  });

  page.drawText("LEARNING PLATFORM", {
    x: width / 2 - fontNormal.widthOfTextAtSize("LEARNING PLATFORM", 14) / 2,
    y: height - 112, font: fontNormal, size: 14, color: rgb(0.91, 0.53, 0.29),
  });

  // Divider
  page.drawLine({ start: { x: 100, y: height - 130 }, end: { x: width - 100, y: height - 130 },
    color: rgb(0.91, 0.53, 0.29), thickness: 1 });

  // Certificate title
  page.drawText("CERTIFICATE OF COMPLETION", {
    x: width / 2 - fontBold.widthOfTextAtSize("CERTIFICATE OF COMPLETION", 22) / 2,
    y: height - 175, font: fontBold, size: 22, color: rgb(0.10, 0.10, 0.18),
  });

  // This certifies that
  page.drawText("This certifies that", {
    x: width / 2 - fontItalic.widthOfTextAtSize("This certifies that", 14) / 2,
    y: height - 215, font: fontItalic, size: 14, color: rgb(0.42, 0.42, 0.50),
  });

  // Student name
  page.drawText(studentName, {
    x: width / 2 - fontBold.widthOfTextAtSize(studentName, 34) / 2,
    y: height - 265, font: fontBold, size: 34, color: rgb(0.91, 0.53, 0.29),
  });

  // Underline for name
  const nameWidth = fontBold.widthOfTextAtSize(studentName, 34);
  page.drawLine({ start: { x: width / 2 - nameWidth / 2, y: height - 272 },
    end: { x: width / 2 + nameWidth / 2, y: height - 272 },
    color: rgb(0.91, 0.53, 0.29), thickness: 1 });

  // Has successfully completed
  page.drawText("has successfully completed the course", {
    x: width / 2 - fontItalic.widthOfTextAtSize("has successfully completed the course", 14) / 2,
    y: height - 305, font: fontItalic, size: 14, color: rgb(0.42, 0.42, 0.50),
  });

  // Course title
  const courseFontSize = courseTitle.length > 50 ? 20 : 26;
  page.drawText(courseTitle, {
    x: width / 2 - fontBold.widthOfTextAtSize(courseTitle, courseFontSize) / 2,
    y: height - 345, font: fontBold, size: courseFontSize, color: rgb(0.10, 0.10, 0.18),
  });

  // Divider
  page.drawLine({ start: { x: 100, y: height - 375 }, end: { x: width - 100, y: height - 375 },
    color: rgb(0.88, 0.86, 0.82), thickness: 0.5 });

  // Footer — instructor + date
  const completedDate = new Date(completedAt).toLocaleDateString("en-NG", {
    day: "numeric", month: "long", year: "numeric",
  });

  page.drawText(`Instructor: ${instructorName}`, {
    x: 120, y: height - 415, font: fontNormal, size: 11, color: rgb(0.42, 0.42, 0.50),
  });

  page.drawText(`Date of Completion: ${completedDate}`, {
    x: width - 120 - fontNormal.widthOfTextAtSize(`Date of Completion: ${completedDate}`, 11),
    y: height - 415, font: fontNormal, size: 11, color: rgb(0.42, 0.42, 0.50),
  });

  // Certificate ID (small, bottom centre)
  page.drawText(`Certificate ID: ${certificateId}`, {
    x: width / 2 - fontNormal.widthOfTextAtSize(`Certificate ID: ${certificateId}`, 9) / 2,
    y: 48, font: fontNormal, size: 9, color: rgb(0.65, 0.65, 0.70),
  });

  return doc.save();
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handlers = {

  /**
   * POST /api/courses/:courseId/certificate
   * Issue or retrieve the certificate for a course.
   * Returns existing certificate if already issued (cached in DB + R2).
   */
  issue: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId       = req.user.id;

    // Check enrollment + completion
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id, progress")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("status", "active")
      .single();

    if (!enrollment)          return res403(res, "You must be enrolled in this course");
    if (enrollment.progress < 100)
      return res400(res, `Course not complete yet — progress is ${enrollment.progress}%`);

    // Return existing certificate if already generated
    const { data: existing } = await db
      .from("certificates")
      .select("id, certificate_url, issued_at")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .single();

    if (existing) return res200(res, existing);

    // Fetch required data for the PDF
    const { data: course } = await db
      .from("courses")
      .select("title, instructor_id, users!courses_instructor_id_fkey(full_name)")
      .eq("id", courseId)
      .single();

    const { data: student } = await db
      .from("users")
      .select("full_name")
      .eq("id", userId)
      .single();

    if (!course)  return res404(res, "Course not found");
    if (!student) return res404(res, "User not found");

    const certificateId  = crypto.randomUUID();
    const instructorName = course.users?.full_name ?? "Piabam Instructor";

    // Generate PDF
    const pdfBytes = await generateCertificatePdf({
      studentName:    student.full_name ?? "Student",
      courseTitle:    course.title,
      instructorName,
      completedAt:    new Date().toISOString(),
      certificateId,
    });

    // Upload to R2
    let certificateUrl;
    if (config.r2.enabled) {
      const r2Key      = `certificates/${userId}/${courseId}.pdf`;
      certificateUrl   = await uploadPdfToR2(pdfBytes, r2Key);
    } else {
      // Dev fallback — serve inline
      certificateUrl = `/api/certificates/${certificateId}/download`;
    }

    // Save to DB
    const { data: cert, error } = await db
      .from("certificates")
      .insert({
        id:             certificateId,
        user_id:        userId,
        course_id:      courseId,
        enrollment_id:  enrollment.id,
        certificate_url: certificateUrl,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    res201(res, cert);
  }),

  /**
   * GET /api/user/certificates
   * List all certificates earned by the current student.
   */
  listMine: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("certificates")
      .select(`
        id, certificate_url, issued_at,
        courses ( id, title, cover_image_url,
          users!courses_instructor_id_fkey ( full_name ) )
      `)
      .eq("user_id", req.user.id)
      .order("issued_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/certificates/:certificateId/verify
   * Public endpoint — verify a certificate by ID.
   * Used by employers / other parties to confirm authenticity.
   */
  verify: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("certificates")
      .select(`
        id, issued_at, certificate_url,
        users!certificates_user_id_fkey ( full_name ),
        courses ( id, title,
          users!courses_instructor_id_fkey ( full_name ) )
      `)
      .eq("id", req.params.certificateId)
      .single();

    if (error || !data) return res404(res, "Certificate not found");

    res200(res, {
      valid:           true,
      certificate_id:  data.id,
      student_name:    data.users?.full_name,
      course_title:    data.courses?.title,
      instructor_name: data.courses?.users?.full_name,
      issued_at:       data.issued_at,
      certificate_url: data.certificate_url,
    });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.post("/courses/:courseId/certificate",       authenticateToken, handlers.issue);
router.get ("/user/certificates",                   authenticateToken, handlers.listMine);
router.get ("/certificates/:certificateId/verify",               handlers.verify);  // public

export default router;
