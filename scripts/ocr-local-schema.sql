-- Add only OCR storage to the existing local Sorye database.
CREATE TABLE IF NOT EXISTS ocr_analyses (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES users(id),
  file_name text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  pages jsonb NOT NULL,
  vector jsonb,
  pattern jsonb,
  error text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_analyses_workspace_created_idx
  ON ocr_analyses(workspace_id, created_at);
ALTER TABLE ocr_analyses ADD COLUMN IF NOT EXISTS vector jsonb;
