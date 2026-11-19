CREATE TABLE annotation_dispositions (
  run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  annotation_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reader','editor','plot','reality')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed')),
  usefulness text CHECK (usefulness IN ('useful','not_useful')),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,annotation_id)
);
