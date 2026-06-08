-- Migration: add target_product_id to periods table
-- Run this in Supabase SQL editor (or via apply_migration).
-- The column is nullable so existing rows are unaffected.

ALTER TABLE periods
  ADD COLUMN IF NOT EXISTS target_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
