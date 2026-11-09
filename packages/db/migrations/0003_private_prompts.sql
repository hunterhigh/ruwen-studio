-- Move platform internals out of ALL user project versions, atomically.
-- No canonical resource, approval event, registry or audit ledger is changed.
REVOKE ALL ON prompts FROM PUBLIC;

CREATE FUNCTION ruwen_public_transcript(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_agg(item ORDER BY ordinal), '[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE '[]'::jsonb END)
 WITH ORDINALITY AS messages(item,ordinal)
 WHERE item->>'role' IN ('user','assistant','toolResult')
$$;

CREATE FUNCTION ruwen_public_role_result(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_object_agg(key, CASE WHEN key='transcript' THEN ruwen_public_transcript(val) ELSE val END), '{}'::jsonb)
 FROM jsonb_each(CASE WHEN jsonb_typeof(value)='object' THEN value ELSE '{}'::jsonb END) AS fields(key,val)
 WHERE key IN ('runtimeMode','output','usage','costTotal','promptSha256','transcript','model','durationMs','readResources','securityEvents')
$$;

CREATE FUNCTION ruwen_capture_role_prompt(value jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE body text;
BEGIN
 FOREACH body IN ARRAY ARRAY[value->>'systemPrompt',value->>'system_prompt'] LOOP
  IF body IS NOT NULL THEN
   INSERT INTO prompts(sha256,content) VALUES(encode(sha256(convert_to(body,'UTF8')),'hex'),body) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
END $$;

INSERT INTO prompts(sha256,content)
SELECT DISTINCT encode(sha256(content),'hex'),convert_from(content,'UTF8')
FROM (
 SELECT content FROM project_files WHERE path LIKE 'authoring-ruwen-v5/reports/prompts/%'
 UNION ALL
 SELECT content FROM project_file_history WHERE path LIKE 'authoring-ruwen-v5/reports/prompts/%'
) AS legacy ON CONFLICT DO NOTHING;

CREATE FUNCTION ruwen_clean_role_artifact(body bytea) RETURNS bytea
LANGUAGE plpgsql AS $$
DECLARE value jsonb; clean jsonb;
BEGIN
 value := convert_from(body,'UTF8')::jsonb;
 IF jsonb_typeof(value)='object' AND (value ? 'promptSha256' OR value ? 'systemPrompt' OR value ? 'system_prompt') THEN
  PERFORM ruwen_capture_role_prompt(value);
  clean := ruwen_public_role_result(value);
  IF clean IS DISTINCT FROM value THEN RETURN convert_to(clean::text || E'\n','UTF8'); END IF;
 END IF;
 RETURN body;
END $$;

UPDATE project_files SET content=ruwen_clean_role_artifact(content)
WHERE path ~ '^authoring-ruwen-v5/reports/(runs/[^/]+/[^/]+|dispatch/[^/]+)\.json$';
DELETE FROM project_files WHERE path LIKE 'authoring-ruwen-v5/reports/prompts/%';
-- file_history trigger records old bytes above; sanitize those snapshots too.
UPDATE project_file_history SET content=ruwen_clean_role_artifact(content)
WHERE path ~ '^authoring-ruwen-v5/reports/(runs/[^/]+/[^/]+|dispatch/[^/]+)\.json$';
UPDATE project_file_history SET sha256=encode(sha256(content),'hex')
WHERE path ~ '^authoring-ruwen-v5/reports/(runs/[^/]+/[^/]+|dispatch/[^/]+)\.json$';
DELETE FROM project_file_history WHERE path LIKE 'authoring-ruwen-v5/reports/prompts/%';

SELECT ruwen_capture_role_prompt(result) FROM role_runs WHERE result IS NOT NULL;
UPDATE role_runs SET result=CASE WHEN result IS NULL THEN NULL ELSE ruwen_public_role_result(result) END,
 transcript=CASE WHEN transcript IS NULL THEN NULL ELSE ruwen_public_transcript(transcript) END;

DROP FUNCTION ruwen_clean_role_artifact(bytea);
DROP FUNCTION ruwen_capture_role_prompt(jsonb);
