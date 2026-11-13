/**
 * Workbook extract: everything the importer takes from Crowdaxe_CRS.xlsm, as plain data.
 * tools/import reads the workbook into this shape; the loader (loader.ts) writes it to the database.
 * Dates are ISO strings: "yyyy-mm-dd" for dates, "yyyy-mm-ddThh:mm:ss" (Harare local time) for date-times.
 */
import { parameterSetSchema } from '@crowdaxe/engine';
import { z } from 'zod';

const s = z.string().nullable();
const n = z.number().nullable();

export const ratingsRowSchema = z.object({
  'Rating ID': z.string(),
  'Deal ID': z.string(),
  Borrower: s,
  'Reg number': s,
  Module: s,
  Track: s,
  'Rating type': s,
  'Rating date': s,
  Analyst: s,
  Reviewer: s,
  'Blended score': n,
  'Obligor model': n,
  'Obligor final': n,
  'Facility model': n,
  'Facility final': n,
  PD: n,
  LGD: n,
  'EAD USD': n,
  'EL USD': n,
  Recommendation: s,
  Overridden: s,
  'Deal History on': s,
  'Methodology version': s,
  Status: s,
  'Saved at': s,
});

export const extractSchema = z.object({
  source: z.object({
    file: z.string(),
    sha256: z.string(),
    workbookVersion: z.string(),
    methodVersion: z.string(),
  }),
  parameterSet: parameterSetSchema,
  ratings: z.array(z.object({ ratingsRow: ratingsRowSchema, inputs: z.record(z.string()) })),
  activity: z.array(
    z.object({
      entryId: z.string(),
      regNo: z.string(),
      borrowerName: s,
      dealId: s,
      event: z.string(),
      eventDate: z.string(),
      dueDate: s,
      amountDue: n,
      amountPaid: n,
      daysLate: n,
      notes: s,
      enteredOn: s,
      enteredBy: s,
    }),
  ),
  dealHistory: z.array(
    z.object({
      regNo: z.string(),
      borrowerName: s,
      dealId: s,
      facilityType: s,
      amount: n,
      disbursementDate: s,
      maturityDate: s,
      status: z.string(),
      maxDpd: n,
      notes: s,
    }),
  ),
  blacklist: z.array(
    z.object({
      regNo: z.string(),
      borrowerName: s,
      status: z.string(),
      blacklistedOn: s,
      reason: s,
      liftedOn: s,
      updated: s,
    }),
  ),
  pipeline: z.array(
    z.object({
      dealId: z.string(),
      borrower: s,
      sectorModule: s,
      track: s,
      facility: s,
      amount: n,
      obligorGrade: n,
      facilityGrade: n,
      pd: n,
      lgd: n,
      elUsd: n,
      recommendation: s,
      stage: s,
      analyst: s,
      reviewer: s,
      ratingDate: s,
      nextReview: s,
      methodVersion: s,
      pdfPath: s,
    }),
  ),
  overrideLog: z.array(
    z.object({
      date: s,
      dealId: s,
      ratingId: z.string(),
      grade: z.string(),
      modelGrade: z.number(),
      finalGrade: z.number(),
      notches: z.number(),
      reason: s,
      approvedBy: s,
      approvalDate: s,
      analyst: s,
    }),
  ),
  changelog: z.array(z.object({ version: z.string(), date: z.string(), change: z.string() })),
});

export type WorkbookExtract = z.infer<typeof extractSchema>;
export type RatingsRow = z.infer<typeof ratingsRowSchema>;
