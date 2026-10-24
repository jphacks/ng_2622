import type { RoomRepository } from "../repositories/roomRepository";

export const getRoom = (repository: RoomRepository, roomId: string) =>
  repository.findSummary(roomId);
