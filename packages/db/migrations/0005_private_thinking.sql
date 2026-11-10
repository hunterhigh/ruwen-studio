-- Never expose provider thinking/signatures, including old cached and historical reports.
-- Canonical files, registry entries and approval/audit facts remain byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION ruwen_public_transcript(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_agg(
  CASE WHEN jsonb_typeof(item->'content')='array' THEN
   jsonb_set(item,'{content}',coalesce((
    SELECT jsonb_agg(block ORDER BY position)
    FROM jsonb_array_elements(item->'content') WITH ORDINALITY AS blocks(block,position)
    WHERE block->>'type' IS DISTINCT FROM 'thinking'
   ),'[]'::jsonb)) ELSE item END ORDER BY ordinal), '[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE '[]'::jsonb END)
 WITH ORDINALITY AS messages(item,ordinal)
 WHERE item->>'role' IN ('user','assistant','toolResult')
$$;

UPDATE role_runs SET result=CASE WHEN result IS NULL THEN NULL ELSE ruwen_public_role_result(result) END,
 transcript=CASE WHEN transcript IS NULL THEN NULL ELSE ruwen_public_transcript(transcript) END;

CREATE FUNCTION ruwen_strip_thinking_artifact(body bytea) RETURNS bytea
LANGUAGE plpgsql AS $$
DECLARE value jsonb; clean jsonb;
BEGIN
 value := convert_from(body,'UTF8')::jsonb;
 IF jsonb_typeof(value)='object' AND value ? 'promptSha256' THEN
  clean := ruwen_public_role_result(value);
  IF clean IS DISTINCT FROM value THEN RETURN convert_to(clean::text || E'\n','UTF8'); END IF;
 END IF;
 RETURN body;
END $$;

UPDATE project_files SET content=ruwen_strip_thinking_artifact(content)
WHERE path ~ '^authoring-ruwen-v5/reports/(runs/[^/]+/[^/]+|dispatch/[^/]+)\.json$';
-- Include the old bytes inserted by the file-history trigger above.
UPDATE project_file_history SET content=ruwen_strip_thinking_artifact(content)
WHERE path ~ '^authoring-ruwen-v5/reports/(runs/[^/]+/[^/]+|dispatch/[^/]+)\.json$';
UPDATE project_file_history SET sha256=encode(sha256(content),'hex')
WHERE path ~ '^authoring-ruwen-v5/reports/(runs/[^/]+/[^/]+|dispatch/[^/]+)\.json$';
DROP FUNCTION ruwen_strip_thinking_artifact(bytea);
