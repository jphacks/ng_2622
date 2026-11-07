import type { PlayRecordInput } from "../durable-objects/playRecords";

const INSTANCE = "global";

export const createPlayRecordRepository = (
  records: CloudflareBindings["PLAY_RECORDS"],
) => ({
  append: (input: PlayRecordInput) => records.getByName(INSTANCE).append(input),
  list: (afterId: number, limit: number) =>
    records.getByName(INSTANCE).list(afterId, limit),
});

export type PlayRecordRepository = ReturnType<
  typeof createPlayRecordRepository
>;
