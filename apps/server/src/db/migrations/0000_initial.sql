CREATE TABLE IF NOT EXISTS "race_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "room_code" text NOT NULL,
  "player_id" text NOT NULL,
  "wpm" integer NOT NULL,
  "accuracy" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "private_room_texts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "room_code" text NOT NULL,
  "text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
