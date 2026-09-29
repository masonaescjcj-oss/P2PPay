-- Phase 9: which version of the terms (and privacy notice) each user accepted, and when.
SET search_path TO app, public;

ALTER TABLE users ADD COLUMN terms_version text;
ALTER TABLE users ADD COLUMN terms_accepted_at bigint;
