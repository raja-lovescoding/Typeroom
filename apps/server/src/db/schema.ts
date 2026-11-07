import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const raceResults = pgTable('race_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomCode: text('room_code').notNull(),
  playerId: text('player_id').notNull(),
  wpm: integer('wpm').notNull(),
  accuracy: integer('accuracy').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const privateRoomTexts = pgTable('private_room_texts', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomCode: text('room_code').notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
