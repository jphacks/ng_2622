import type { PlayRecordInput } from "../durable-objects/playRecords";

const INSTANCE = "global";

export const createPlayRecordRepository = (
  records: CloudflareBindings["PLAY_RECORDS"],
) => ({
  append: (input: PlayRecordInput) => records.getByName(INSTANCE).append(input),
  listByDevice: (deviceId: string) =>
    records.getByName(INSTANCE).listByDevice(deviceId),
});

export type PlayRecordRepository = ReturnType<
  typeof createPlayRecordRepository
>;
