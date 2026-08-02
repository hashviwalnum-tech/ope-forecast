-- Migration: allow products.lead_time_days to be NULL for service products
-- Run this in Supabase SQL editor (or via apply_migration).
-- Services (product_type='service') are performed, not held, and have no
-- lead time, reorder point, safety stock, storage capacity, or shelf life —
-- those are physical-good-only fields. Existing 'stocked' rows are unaffected.

ALTER TABLE products
  ALTER COLUMN lead_time_days DROP NOT NULL;
