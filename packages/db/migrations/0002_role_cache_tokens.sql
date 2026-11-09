ALTER TABLE role_runs ADD COLUMN cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK(cache_read_tokens>=0);
ALTER TABLE role_runs ADD COLUMN cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK(cache_write_tokens>=0);
