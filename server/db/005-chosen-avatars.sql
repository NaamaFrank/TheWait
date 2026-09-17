-- Chosen avatars, instead of uploaded photographs.
--
-- Photos were public, unmoderated and stored a real face on the server. A small
-- set of characters gives people something recognisable to be without any of
-- that: nothing is uploaded, nothing needs moderating, and there is no image to
-- leak. The uploaded ones go with the table.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar text;

-- Everyone gets one, picked from their account id so it is stable and varied.
UPDATE accounts
SET avatar = (ARRAY['🐻','🦊','🐼','🐨','🐸','🐙','🦉','🐧','🦄','🐝','🐢','🦋','🐳','🌵','🍄','⭐'])
             [1 + (('x' || substr(md5(account_id::text), 1, 8))::bit(32)::bigint % 16)]
WHERE avatar IS NULL;

ALTER TABLE accounts ALTER COLUMN avatar SET NOT NULL;

-- Nothing holds a photograph any more.
DROP TABLE IF EXISTS avatars;
